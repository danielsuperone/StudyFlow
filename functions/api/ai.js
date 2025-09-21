const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const jsonResponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
  });

const textResponse = (text, status = 200) =>
  new Response(text, {
    status,
    headers: Object.assign({ 'Content-Type': 'text/plain' }, CORS_HEADERS)
  });

const ALLOWED_PATHS = new Set(['/api/ai', '/api/ai/']);

const pad = (n) => n.toString().padStart(2, '0');

const formatOffset = (minutes) => {
  const value = Number.isFinite(minutes) ? minutes : 0;
  if (value === 0) return 'UTC';
  const total = -value;
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  const hours = pad(Math.floor(abs / 60));
  const mins = pad(Math.abs(abs % 60));
  return `UTC${sign}${hours}:${mins}`;
};

const formatLocalDate = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

const resolveClientContext = (payload) => {
  const ctx = payload && typeof payload === 'object' ? payload : {};
  let base = null;
  if (ctx.nowISO && typeof ctx.nowISO === 'string') {
    const parsed = new Date(ctx.nowISO);
    if (!Number.isNaN(parsed.getTime())) base = parsed;
  }
  if (!base) base = new Date();

  let offsetMinutes = null;
  if (typeof ctx.offsetMinutes === 'number' && Number.isFinite(ctx.offsetMinutes)) {
    offsetMinutes = ctx.offsetMinutes;
  } else if (typeof ctx.offsetMinutes === 'string') {
    const parsedOffset = Number(ctx.offsetMinutes);
    if (Number.isFinite(parsedOffset)) offsetMinutes = parsedOffset;
  }

  if (offsetMinutes === null && ctx.nowLocal && typeof ctx.nowLocal === 'string') {
    const parsedLocal = new Date(ctx.nowLocal.replace(' ', 'T'));
    if (!Number.isNaN(parsedLocal.getTime())) {
      offsetMinutes = Math.round((base.getTime() - parsedLocal.getTime()) / 60000);
    }
  }

  const effectiveOffset = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const timezone = ctx.timezone && typeof ctx.timezone === 'string' ? ctx.timezone : 'UTC';
  const localDate = new Date(base.getTime() - effectiveOffset * 60000);
  const localFormatted = ctx.nowLocal && typeof ctx.nowLocal === 'string'
    ? ctx.nowLocal
    : formatLocalDate(localDate);

  return {
    base,
    localDate,
    offsetMinutes: effectiveOffset,
    timezone,
    offsetLabel: formatOffset(effectiveOffset),
    localFormatted
  };
};

const buildMessages = (text, clientContext) => {
  const systemPrompt = [
    'You are a scheduling assistant for a timetable web app.',
    `The user\'s current local datetime is ${clientContext.localFormatted} (${clientContext.timezone}${clientContext.offsetLabel === 'UTC' ? '' : ' | ' + clientContext.offsetLabel}).`,
    'Treat that timestamp as authoritative. When the user uses relative language ("today", "tomorrow", "next Monday", "in two hours"), resolve it using that local time.',
    'Always respond with valid JSON matching { action: "none"|"add"|"find_hangout"|"error", reply: string, events?: [ { title, startISO, endISO, color, recurring } ] }.',
    'Every events[].startISO and events[].endISO must be formatted as "YYYY-MM-DD HH:MM" in the user\'s local timezone. Do not emit UTC or other timezone conversions.',
    'Do not invent the current date; rely solely on the provided context.'
  ].join('\n');

  const contextBlock = JSON.stringify({
    timezone: clientContext.timezone,
    offsetMinutes: clientContext.offsetMinutes,
    offsetLabel: clientContext.offsetLabel,
    localDateTime: clientContext.localFormatted,
    isoReference: clientContext.base.toISOString()
  }, null, 2);

  const userPrompt = `Request:\n${text}\n\nClientContext:\n${contextBlock}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
};

export const onRequest = async ({ request, env }) => {
  const url = new URL(request.url);

  if (!ALLOWED_PATHS.has(url.pathname)) {
    return textResponse('Not found', 404);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === 'GET') {
    const provider = (env.AI_PROVIDER || 'openrouter').toLowerCase();
    return jsonResponse({
      ok: true,
      provider,
      hasOpenrouter: !!env.OPENROUTER_API_KEY,
      hasOpenai: !!env.OPENAI_API_KEY
    }, 200);
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const text = body && body.text ? body.text : null;
      if (!text || typeof text !== 'string') {
        return jsonResponse({ error: 'Missing text' }, 400);
      }

      const clientContext = resolveClientContext(body || {});
      const provider = (env.AI_PROVIDER || 'openrouter').toLowerCase();

      function checkRequiredServerVars() {
        const missing = [];
        if (provider === 'openrouter') {
          if (!env.OPENROUTER_API_KEY) missing.push('OPENROUTER_API_KEY');
        } else if (provider === 'openai') {
          if (!env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
        }
        if (!env.MODEL) missing.push('MODEL (recommended)');
        return missing;
      }

      const missingServer = checkRequiredServerVars();
      if (missingServer.length) {
        const msg = 'Missing required server environment variables for AI provider: ' + missingServer.join(', ') + '. Set these in Cloudflare Pages (Project -> Settings -> Environment variables).';
        return jsonResponse({ error: msg }, 500);
      }

      function localParseToJSON(t, ctx) {
        const lower = (t || '').toLowerCase();
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const localNow = ctx && ctx.localDate instanceof Date ? new Date(ctx.localDate.getTime()) : new Date();
        const tzLabel = ctx && ctx.timezone ? `${ctx.timezone}${ctx.offsetLabel === 'UTC' ? '' : ' (' + ctx.offsetLabel + ')'}` : 'local timezone';

        if (/add|recur|recurring/.test(lower)) {
          let dayFound = days.find((d) => lower.includes(d)) || 'monday';
          let hh = '14';
          let mm = '00';
          const pm = /([0-9]{1,2})\s*(?:pm|p\.m\.)/.exec(lower);
          const am = /([0-9]{1,2})\s*(?:am|a\.m\.|in the morning|morning)/.exec(lower);
          const time24 = /([01]?[0-9]|2[0-3]):([0-5][0-9])/.exec(lower);
          if (time24) {
            hh = time24[1].padStart(2, '0');
            mm = time24[2];
          } else if (pm) {
            const h = parseInt(pm[1], 10);
            hh = ((h % 12) + 12).toString().padStart(2, '0');
          } else if (am) {
            const h = parseInt(am[1], 10);
            hh = (h % 12).toString().padStart(2, '0');
          } else {
            const atNum = /(?:at\s*)?(?:around\s*)?(?:about\s*)?(?:at\s*)?([0-9]{1,2})(?:\s*o'clock)?(?!:)/.exec(lower);
            if (atNum) {
              const h = parseInt(atNum[1], 10);
              if (!Number.isNaN(h)) hh = (h % 24).toString().padStart(2, '0');
            }
          }
          const subj = (lower.match(/subject\s+([a-z]+)/) || lower.match(/lesson\s+([a-z]+)/) || [])[1] || 'Event';
          const colorMatch = (lower.match(/color\s+#?[0-9a-f]{3,6}/) || [])[0] || '#6ee7b7';
          const todayIdx = localNow.getUTCDay() === 0 ? 6 : localNow.getUTCDay() - 1;
          const targetIdx = days.indexOf(dayFound);
          let delta = (targetIdx - todayIdx + 7) % 7;
          if (delta === 0) delta = 7;
          const when = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + delta, parseInt(hh, 10), parseInt(mm, 10)));
          const endWhen = new Date(when.getTime() + 60 * 60 * 1000);
          return {
            action: 'add',
            reply: `(local) Added ${subj} on next ${dayFound} at ${hh}:${mm} (${tzLabel})`,
            events: [
              {
                title: subj || 'Event',
                startISO: formatLocalDate(when),
                endISO: formatLocalDate(endWhen),
                color: colorMatch.replace('color', '').trim(),
                recurring: true
              }
            ]
          };
        }
        return {
          action: 'none',
          reply: `(local) I understood nothing. Example: add lesson math on 2025-09-20 15:00-16:00 color #6ee7b7 recurring (current local time ${formatLocalDate(localNow)} ${tzLabel})`
        };
      }

      if (provider === 'openrouter') {
        const key = env.OPENROUTER_API_KEY;
        if (!key) {
          const local = localParseToJSON(text, clientContext);
          return jsonResponse(local, 200);
        }

        const model = env.MODEL || 'openrouter/release-1';
        const openrouterUrl = env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
        const FAST_MS = Number(env.AI_FAST_FALLBACK_MS || 2000);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FAST_MS);

        try {
          const resp = await fetch(openrouterUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model,
              messages: buildMessages(text, clientContext),
              max_tokens: 256,
              temperature: 0.15
            }),
            signal: controller.signal
          });
          clearTimeout(timer);
          const data = await resp.json().catch(() => ({}));
          const out = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
          try {
            const parsed = JSON.parse(out);
            return jsonResponse(parsed, 200);
          } catch (e) {
            const jsonMatch = ('' + out).match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                return jsonResponse(JSON.parse(jsonMatch[0]), 200);
              } catch (_) {}
            }
            return jsonResponse({ error: 'Invalid model output', raw: out }, 502);
          }
        } catch (err) {
          clearTimeout(timer);
          try {
            const local = localParseToJSON(text, clientContext);
            return jsonResponse(local, 200);
          } catch (e) {
            return jsonResponse({
              error: 'OpenRouter unreachable and local parser failed',
              detail: (e && e.message) || String(e)
            }, 502);
          }
        }
      }

      return jsonResponse({ error: 'Unsupported provider' }, 502);
    } catch (err) {
      return jsonResponse({ error: err && err.message ? err.message : String(err) }, 500);
    }
  }

  return textResponse('Method not allowed', 405);
};
