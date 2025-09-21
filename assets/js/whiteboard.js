(function (global) {
  'use strict';

  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

  let perf = typeof performance !== 'undefined' ? performance : null;
  if (!perf && typeof require === 'function') {
    try {
      const perfHooks = require('node:perf_hooks');
      if (perfHooks && perfHooks.performance) {
        perf = perfHooks.performance;
      }
    } catch (err) {
      // ignore
    }
  }
  if (!perf) {
    perf = { now: () => Date.now() };
  }

  const raf = isBrowser && typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (cb) => setTimeout(() => cb(perf.now()), 16);

  const caf = isBrowser && typeof window.cancelAnimationFrame === 'function'
    ? window.cancelAnimationFrame.bind(window)
    : clearTimeout;

  const now = () => perf.now();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distSq = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };

  function smoothValue(current, target, smoothing, deltaMs) {
    if (smoothing <= 0) return target;
    const factor = deltaMs > 0 ? deltaMs / 16.67 : 1;
    const t = 1 - Math.pow(1 - smoothing, factor);
    return current + (target - current) * t;
  }

  function createUid(prefix = 'wb') {
    if (isBrowser && window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    const random = Math.random().toString(16).slice(2);
    return `${prefix}_${Date.now().toString(16)}_${random}`;
  }

  function parseHexColor(hex) {
    const value = (hex || '').trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      return { r: 46, g: 46, b: 46 };
    }
    const raw = value.slice(1);
    if (raw.length === 3) {
      const r = parseInt(raw[0] + raw[0], 16);
      const g = parseInt(raw[1] + raw[1], 16);
      const b = parseInt(raw[2] + raw[2], 16);
      return { r, g, b };
    }
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return { r, g, b };
  }

  function relativeLuminance(rgb) {
    const normalize = (channel) => {
      const v = channel / 255;
      if (v <= 0.03928) return v / 12.92;
      return Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = normalize(rgb.r);
    const g = normalize(rgb.g);
    const b = normalize(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastColor(hex) {
    const rgb = parseHexColor(hex);
    const lum = relativeLuminance(rgb);
    return lum > 0.45 ? '#111827' : '#ffffff';
  }

  function mixColor(hex, amount = 0.25) {
    const rgb = parseHexColor(hex);
    const blendChannel = (value) => {
      const normalized = value / 255;
      const mixed = normalized + amount * (1 - normalized);
      return Math.round(clamp(mixed, 0, 1) * 255);
    };
    const r = blendChannel(rgb.r);
    const g = blendChannel(rgb.g);
    const b = blendChannel(rgb.b);
    return `rgba(${r}, ${g}, ${b}, 0.92)`;
  }

  function clampLabelRect(x, y, width, height, stageWidth, stageHeight, margin = 8) {
    let clampedX = x;
    let clampedY = y;
    if (clampedX < margin) clampedX = margin;
    if (clampedX + width > stageWidth - margin) {
      clampedX = Math.max(margin, stageWidth - margin - width);
    }
    if (clampedY < margin) clampedY = margin;
    if (clampedY + height > stageHeight - margin) {
      clampedY = Math.max(margin, stageHeight - margin - height);
    }
    return { x: clampedX, y: clampedY };
  }

  class ViewTransform {
    constructor() {
      this.scale = 1;
      this.offset = { x: 0, y: 0 };
    }

    set({ scale, offset } = {}) {
      if (typeof scale === 'number' && scale > 0) {
        this.scale = scale;
      }
      if (offset && typeof offset.x === 'number' && typeof offset.y === 'number') {
        this.offset = { x: offset.x, y: offset.y };
      }
    }

    worldToScreen(point) {
      return {
        x: (point.x - this.offset.x) * this.scale,
        y: (point.y - this.offset.y) * this.scale
      };
    }

    screenToWorld(point) {
      return {
        x: point.x / this.scale + this.offset.x,
        y: point.y / this.scale + this.offset.y
      };
    }
  }

  function createThrottledSender(send, intervalMs, options = {}) {
    let lastSendAt = -Infinity;
    let timer = null;
    let pendingPayload = null;
    const nowFn = typeof options.now === 'function' ? options.now : () => now();
    const scheduleFn = typeof options.schedule === 'function'
      ? options.schedule
      : (delay, fn) => setTimeout(fn, delay);
    const cancelFn = typeof options.cancel === 'function'
      ? options.cancel
      : (handle) => clearTimeout(handle);

    const flush = () => {
      timer = null;
      if (!pendingPayload) return;
      const payload = pendingPayload;
      pendingPayload = null;
      lastSendAt = nowFn();
      send(payload);
    };

    return (payload, force = false) => {
      if (payload !== undefined) {
        pendingPayload = payload;
      }
      if (!pendingPayload) return;

      const current = nowFn();
      const elapsed = current - lastSendAt;

      if (force || elapsed >= intervalMs) {
        if (timer) {
          cancelFn(timer);
          timer = null;
        }
        const out = pendingPayload;
        pendingPayload = null;
        lastSendAt = current;
        send(out);
        return;
      }

      if (!timer) {
        const delay = Math.max(0, intervalMs - elapsed);
        timer = scheduleFn(delay, flush);
      }
    };
  }

  const LOCAL_SMOOTHING = 0.32;
  const REMOTE_SMOOTHING = 0.24;
  const LABEL_PADDING_X = 10;
  const LABEL_PADDING_Y = 6;
  const LABEL_OFFSET_Y = -26;
  const REMOTE_BUFFER_MS = 80;
  const REMOTE_EXTRAPOLATE_MS = 120;
  const SNAP_DISTANCE_PX = 200;
  class CursorOverlay {
    constructor(container, transform, opts = {}) {
      if (!isBrowser) {
        throw new Error('CursorOverlay requires a browser environment');
      }
      this.container = container;
      this.transform = transform;
      this.stage = opts.stage || container;
      this.devicePixelRatioProvider = () => (window.devicePixelRatio || 1);
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'absolute';
      this.canvas.style.inset = '0';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.setAttribute('aria-hidden', 'true');
      container.innerHTML = '';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.stageSize = { width: 0, height: 0 };
      this.running = false;
      this.frame = null;
      this.lastFrameTime = null;
      this.snapDistanceSq = Math.pow(opts.snapDistance || SNAP_DISTANCE_PX, 2);
      this.remoteBufferMs = opts.remoteBufferMs || REMOTE_BUFFER_MS;
      this.remoteExtrapolateMs = opts.remoteExtrapolateMs || REMOTE_EXTRAPOLATE_MS;

      this.local = {
        visible: false,
        brushRadius: opts.defaultBrushRadius || 6,
        color: opts.defaultColor || '#2e2e2e',
        name: opts.localName || 'You',
        targetWorld: { x: 0, y: 0 },
        displayScreen: { x: 0, y: 0 },
        alpha: 0,
        lastUpdate: 0
      };

      this.remotes = new Map();

      this.resize();
    }

    resize() {
      const rect = this.stage.getBoundingClientRect();
      this.stageSize.width = rect.width;
      this.stageSize.height = rect.height;
      const dpr = this.devicePixelRatioProvider();
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    setTransform(transform) {
      this.transform = transform;
    }

    setLocalBrush({ radius, color, name } = {}) {
      if (typeof radius === 'number') {
        this.local.brushRadius = radius;
      }
      if (color) {
        this.local.color = color;
      }
      if (name) {
        this.local.name = name;
      }
    }

    setLocalTarget(worldPoint) {
      this.local.targetWorld = { x: worldPoint.x, y: worldPoint.y };
      this.local.lastUpdate = now();
      if (!this.local.visible) {
        this.local.displayScreen = this.transform.worldToScreen(worldPoint);
      }
      this.local.visible = true;
    }

    setLocalVisible(isVisible) {
      this.local.visible = isVisible;
      if (!isVisible) {
        this.local.lastUpdate = now();
      }
    }

    updateRemoteMeta(userId, meta = {}) {
      let remote = this.remotes.get(userId);
      if (!remote) {
        remote = {
          userId,
          name: meta.name || `User ${userId.slice(-4)}`,
          color: meta.color || '#2563eb',
          brushRadius: typeof meta.brushRadius === 'number' ? meta.brushRadius : 6,
          samples: [],
          velocity: { x: 0, y: 0 },
          displayScreen: { x: 0, y: 0 },
          alpha: 0,
          visible: false,
          idle: !!meta.idle,
          lastUpdate: 0
        };
        this.remotes.set(userId, remote);
        return;
      }
      if (meta.name) remote.name = meta.name;
      if (meta.color) remote.color = meta.color;
      if (typeof meta.brushRadius === 'number') remote.brushRadius = meta.brushRadius;
      if (typeof meta.idle === 'boolean') remote.idle = meta.idle;
    }

    upsertRemoteCursor(userId, payload) {
      let remote = this.remotes.get(userId);
      if (!remote) {
        remote = {
          userId,
          name: payload.name || `User ${userId.slice(-4)}`,
          color: payload.color || '#2563eb',
          brushRadius: payload.brushRadius || 6,
          samples: [],
          velocity: { x: 0, y: 0 },
          displayScreen: { x: 0, y: 0 },
          alpha: 0,
          visible: true,
          idle: false,
          lastUpdate: 0
        };
        this.remotes.set(userId, remote);
      }
      if (payload.name) remote.name = payload.name;
      if (payload.color) remote.color = payload.color;
      if (typeof payload.brushRadius === 'number') remote.brushRadius = payload.brushRadius;

      const arrival = now();
      const sample = { x: payload.x, y: payload.y, time: arrival };
      const prev = remote.samples.length ? remote.samples[remote.samples.length - 1] : null;
      remote.samples.push(sample);
      if (remote.samples.length > 6) {
        remote.samples.shift();
      }
      if (prev) {
        const dt = sample.time - prev.time;
        if (dt > 0) {
          remote.velocity = {
            x: (sample.x - prev.x) / dt,
            y: (sample.y - prev.y) / dt
          };
        }
      }
      remote.visible = true;
      remote.idle = false;
      remote.lastUpdate = arrival;
    }

    setRemoteIdle(userId, idle) {
      const remote = this.remotes.get(userId);
      if (!remote) return;
      remote.idle = idle;
      if (!idle) {
        remote.visible = true;
        remote.lastUpdate = now();
      }
    }

    removeRemote(userId) {
      this.remotes.delete(userId);
    }

    clearRemotes() {
      this.remotes.clear();
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = (timestamp) => {
        if (!this.running) return;
        this.render(timestamp);
        this.frame = raf(loop);
      };
      this.frame = raf(loop);
    }

    stop() {
      this.running = false;
      if (this.frame) {
        caf(this.frame);
        this.frame = null;
      }
    }

    render(timestamp) {
      if (!this.ctx) return;
      if (!this.stageSize.width || !this.stageSize.height) return;
      const ctx = this.ctx;
      const width = this.stageSize.width;
      const height = this.stageSize.height;
      ctx.clearRect(0, 0, width, height);
      const deltaMs = this.lastFrameTime ? Math.min(100, timestamp - this.lastFrameTime) : 16.67;
      this.lastFrameTime = timestamp;

      const localRender = this.updateLocal(deltaMs);
      const remoteRenders = [];
      for (const remote of this.remotes.values()) {
        const entry = this.updateRemote(remote, deltaMs, timestamp);
        if (entry) {
          remoteRenders.push(entry);
        }
      }

      if (localRender) {
        this.drawCursor(localRender);
      }
      for (const entry of remoteRenders) {
        this.drawCursor(entry);
      }

      for (const [id, remote] of Array.from(this.remotes.entries())) {
        if (remote.alpha < 0.01 && remote.samples.length === 0 && timestamp - remote.lastUpdate > 15000) {
          this.remotes.delete(id);
        }
      }
    }

    updateLocal(deltaMs) {
      const state = this.local;
      const targetScreen = this.transform.worldToScreen(state.targetWorld);
      const targetAlpha = state.visible ? 1 : 0;
      state.alpha = smoothValue(state.alpha, targetAlpha, 0.22, deltaMs);
      state.displayScreen.x = smoothValue(state.displayScreen.x, targetScreen.x, LOCAL_SMOOTHING, deltaMs);
      state.displayScreen.y = smoothValue(state.displayScreen.y, targetScreen.y, LOCAL_SMOOTHING, deltaMs);
      if (state.alpha < 0.01) return null;
      return {
        x: state.displayScreen.x,
        y: state.displayScreen.y,
        brushRadius: state.brushRadius,
        color: state.color,
        name: state.name,
        alpha: state.alpha,
        isLocal: true
      };
    }

    updateRemote(remote, deltaMs, timestamp) {
      if (!remote.samples.length) {
        remote.alpha = smoothValue(remote.alpha, remote.visible && !remote.idle ? 1 : 0, REMOTE_SMOOTHING, deltaMs);
        if (remote.alpha < 0.01) {
          return null;
        }
        return {
          x: remote.displayScreen.x,
          y: remote.displayScreen.y,
          brushRadius: remote.brushRadius,
          color: remote.color,
          name: remote.name,
          alpha: remote.alpha,
          isLocal: false
        };
      }

      const targetTime = timestamp - this.remoteBufferMs;
      let older = null;
      let newer = null;

      for (let i = remote.samples.length - 1; i >= 0; i -= 1) {
        const sample = remote.samples[i];
        if (sample.time <= targetTime && !older) {
          older = sample;
          newer = remote.samples[i + 1] || sample;
          break;
        }
      }

      if (!older) {
        older = remote.samples[0];
        newer = remote.samples[1] || older;
      } else if (!newer) {
        newer = older;
      }

      let targetWorld = { x: newer.x, y: newer.y };
      if (older && newer && newer.time !== older.time) {
        const span = newer.time - older.time;
        const t = clamp((targetTime - older.time) / span, 0, 1);
        targetWorld = {
          x: lerp(older.x, newer.x, t),
          y: lerp(older.y, newer.y, t)
        };
      }

      if (targetTime > newer.time && remote.velocity) {
        const extra = clamp(targetTime - newer.time, 0, this.remoteExtrapolateMs);
        targetWorld = {
          x: targetWorld.x + remote.velocity.x * extra,
          y: targetWorld.y + remote.velocity.y * extra
        };
      }

      const targetScreen = this.transform.worldToScreen(targetWorld);
      const distance = distSq(remote.displayScreen.x, remote.displayScreen.y, targetScreen.x, targetScreen.y);
      if (distance > this.snapDistanceSq) {
        remote.displayScreen = { x: targetScreen.x, y: targetScreen.y };
      } else {
        remote.displayScreen.x = smoothValue(remote.displayScreen.x, targetScreen.x, REMOTE_SMOOTHING, deltaMs);
        remote.displayScreen.y = smoothValue(remote.displayScreen.y, targetScreen.y, REMOTE_SMOOTHING, deltaMs);
      }

      const active = !remote.idle && (timestamp - remote.lastUpdate) < 6000;
      remote.alpha = smoothValue(remote.alpha, active ? 1 : 0, REMOTE_SMOOTHING, deltaMs);

      if (remote.alpha < 0.01) {
        return null;
      }

      return {
        x: remote.displayScreen.x,
        y: remote.displayScreen.y,
        brushRadius: remote.brushRadius,
        color: remote.color,
        name: remote.name,
        alpha: remote.alpha,
        isLocal: false
      };
    }

    drawCursor(entry) {
      const ctx = this.ctx;
      const radius = Math.max(6, entry.brushRadius);
      const stageW = this.stageSize.width;
      const stageH = this.stageSize.height;

      ctx.save();
      ctx.globalAlpha = entry.alpha;

      ctx.fillStyle = entry.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, radius * 0.18);

      ctx.beginPath();
      ctx.arc(entry.x, entry.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const fontSize = 12;
      ctx.font = `${fontSize}px Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const textWidth = ctx.measureText(entry.name).width;
      const labelWidth = textWidth + LABEL_PADDING_X * 2;
      const labelHeight = fontSize + LABEL_PADDING_Y * 2;
      let rectX = entry.x - labelWidth / 2;
      let rectY = entry.y + LABEL_OFFSET_Y - radius - labelHeight / 2;

      const clamped = clampLabelRect(rectX, rectY, labelWidth, labelHeight, stageW, stageH);
      rectX = clamped.x;
      rectY = clamped.y;
      const labelCenterX = rectX + labelWidth / 2;
      const labelCenterY = rectY + labelHeight / 2;

      ctx.fillStyle = mixColor(entry.color, 0.28);
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(rectX + r, rectY);
      ctx.lineTo(rectX + labelWidth - r, rectY);
      ctx.quadraticCurveTo(rectX + labelWidth, rectY, rectX + labelWidth, rectY + r);
      ctx.lineTo(rectX + labelWidth, rectY + labelHeight - r);
      ctx.quadraticCurveTo(rectX + labelWidth, rectY + labelHeight, rectX + labelWidth - r, rectY + labelHeight);
      ctx.lineTo(rectX + r, rectY + labelHeight);
      ctx.quadraticCurveTo(rectX, rectY + labelHeight, rectX, rectY + labelHeight - r);
      ctx.lineTo(rectX, rectY + r);
      ctx.quadraticCurveTo(rectX, rectY, rectX + r, rectY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = contrastColor(entry.color);
      ctx.fillText(entry.name, labelCenterX, labelCenterY + 1);

      ctx.restore();
    }
  }
  const fallbackChannels = new Map();

  function getFallbackChannel(name) {
    let set = fallbackChannels.get(name);
    if (!set) {
      set = new Set();
      fallbackChannels.set(name, set);
    }
    return set;
  }

  function createDefaultTransport(name) {
    if (isBrowser && typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(name);
      return {
        send(message) {
          channel.postMessage(message);
        },
        subscribe(handler) {
          const listener = (event) => handler(event.data);
          channel.addEventListener('message', listener);
          return () => channel.removeEventListener('message', listener);
        },
        close() {
          channel.close();
        }
      };
    }
    const pool = getFallbackChannel(name);
    const handlers = new Set();
    return {
      send(message) {
        for (const handler of Array.from(pool)) {
          try {
            handler(message);
          } catch (err) {
            // ignore listener errors
          }
        }
      },
      subscribe(handler) {
        pool.add(handler);
        handlers.add(handler);
        return () => {
          pool.delete(handler);
          handlers.delete(handler);
        };
      },
      close() {
        for (const handler of handlers) {
          pool.delete(handler);
        }
        handlers.clear();
      }
    };
  }

  class CursorNetworking {
    constructor(options) {
      this.boardId = options.boardId;
      this.userId = options.userId;
      this.name = options.name;
      this.color = options.color;
      this.brushRadius = options.brushRadius || 6;
      this.clientId = options.clientId || createUid('client');
      this.throttleMs = options.throttleMs || 40;
      this.strokeThrottleMs = options.strokeThrottleMs || 25;
      this.idleMs = options.idleMs || 5000;
      this.onCursor = options.onCursor;
      this.onPresence = options.onPresence;
  this.onStroke = options.onStroke;
  this.onControl = options.onControl;
      this.transport = options.transport || createDefaultTransport(`whiteboard:${this.boardId}`);
      this.disposed = false;
      this.isIdle = false;
      this.idleTimer = null;
      this.lastActiveAt = now();
      this.unsubscribe = this.transport.subscribe((data) => this.handleMessage(data));
      this.sender = createThrottledSender((payload) => {
        this.send({
          type: 'cursor',
          payload
        });
      }, this.throttleMs, options.throttleOptions);
      this.strokeSender = createThrottledSender((payload) => {
        this.send({ type: 'stroke', payload });
      }, this.strokeThrottleMs, options.throttleOptions);
      this.sendPresence('join');
      this.scheduleIdleCheck();
    }

    updateProfile({ name, color } = {}) {
      if (name) this.name = name;
      if (color) this.color = color;
      this.sendPresence('active');
    }

    updateBrush(radius) {
      if (typeof radius === 'number') {
        this.brushRadius = radius;
      }
    }

    updateColor(color) {
      if (color) {
        this.color = color;
        this.sendPresence('active');
      }
    }

    handleMessage(message) {
      if (this.disposed || !message) return;
      if (message.boardId !== this.boardId) return;
      if (message.senderId === this.clientId) return;
      if (message.type === 'cursor') {
        const payload = message.payload || {};
        if (typeof this.onCursor === 'function') {
          this.onCursor(Object.assign({}, payload));
        }
      } else if (message.type === 'stroke') {
        const payload = message.payload || {};
        if (typeof this.onStroke === 'function') {
          this.onStroke(Object.assign({}, payload));
        }
      } else if (message.type === 'control') {
        const payload = message.payload || {};
        if (typeof this.onControl === 'function') {
          this.onControl(Object.assign({}, payload));
        }
      } else if (message.type === 'presence') {
        if (typeof this.onPresence === 'function') {
          this.onPresence(Object.assign({}, message.payload || {}));
        }
      }
    }

    updateLocalCursor(cursor) {
      if (this.disposed) return;
      const payload = {
        userId: this.userId,
        name: this.name,
        color: cursor.color || this.color,
        brushRadius: cursor.brushRadius != null ? cursor.brushRadius : this.brushRadius,
        x: cursor.x,
        y: cursor.y,
        ts: Date.now()
      };
      this.color = payload.color;
      this.brushRadius = payload.brushRadius;
      this.lastActiveAt = now();
      if (this.isIdle) {
        this.isIdle = false;
        this.sendPresence('active');
      }
      this.sender(payload);
      this.scheduleIdleCheck();
    }

    flush() {
      if (this.disposed) return;
      this.sender(undefined, true);
    }
    sendStroke(segment) {
      if (this.disposed) return;
      if (!segment) return;
      this.strokeSender(segment);
    }
    sendStrokeBatch(segments){
      if (this.disposed) return;
      if (!Array.isArray(segments) || !segments.length) return;
      // bypass throttle to send as one packet
      this.send({ type: 'stroke', payload: segments });
    }

    scheduleIdleCheck() {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }
      this.idleTimer = setTimeout(() => this.markIdleIfNeeded(), this.idleMs);
    }

    markIdleIfNeeded() {
      if (this.disposed || this.isIdle) return;
      const elapsed = now() - this.lastActiveAt;
      if (elapsed >= this.idleMs - 10) {
        this.isIdle = true;
        this.sendPresence('idle');
      } else {
        this.scheduleIdleCheck();
      }
    }

    pokeIdle() {
      if (this.disposed) return;
      this.scheduleIdleCheck();
    }

    sendPresence(action) {
      this.send({
        type: 'presence',
        payload: {
          action,
          userId: this.userId,
          name: this.name,
          color: this.color,
          brushRadius: this.brushRadius,
          ts: Date.now()
        }
      });
    }

    send(message) {
      if (this.disposed) return;
      this.transport.send({
        boardId: this.boardId,
        senderId: this.clientId,
        type: message.type,
        payload: message.payload
      });
    }

    destroy() {
      if (this.disposed) return;
      this.sender(undefined, true);
      this.sendPresence('leave');
      this.disposed = true;
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
      if (this.transport && typeof this.transport.close === 'function') {
        this.transport.close();
      }
    }
  }

  const state = {
    initialized: false,
    listenersAttached: false,
    stageEl: null,
    canvasEl: null,
    ctx: null,
    cursorContainer: null,
    overlay: null,
    transform: new ViewTransform(),
    user: null,
    clientId: null,
    boardId: null,
    networking: null,
    pointerDown: false,
    localPointerWorld: { x: 0, y: 0 },
    lastCanvasPoint: null,
    brush: { radius: 6, color: '#2e2e2e' },
    tool: 'pen', // 'pen' | 'highlighter' | 'eraser'
    lastPointerMove: 0,
    identity: null,
    // Batching for network and DB
    strokeBatch: [],
    strokeBatchTimer: null,
    strokeBatchIntervalMs: 30,
    // Firebase persistence
    dbRef: null,
    dbUnsubscribe: null,
    dbBatch: [],
    dbFlushTimer: null,
    dbFlushIntervalMs: 140,
    dbSeenNodes: new Set(),
    // UI bits
    loadingEl: null,
    loadingTimer: null,
    // Permissions & local fallback
    dbWritesDisabled: false,
    localHistory: new Map(),
    localHistoryHashes: new Map()
  };
  const LOCAL_HISTORY_LIMIT = 50000;

  function segmentHashValue(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toFixed(2) : '0';
    }
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function createSegmentHash(seg = {}) {
    return [
      segmentHashValue(seg.x1),
      segmentHashValue(seg.y1),
      segmentHashValue(seg.x2),
      segmentHashValue(seg.y2),
      segmentHashValue(seg.color),
      segmentHashValue(seg.width),
      segmentHashValue(seg.alpha),
      segmentHashValue(seg.op),
      segmentHashValue(seg.tool)
    ].join('|');
  }

  function appendToLocalHistory(boardId, segments) {
    if (!boardId) return;
    const segs = Array.isArray(segments) ? segments : [segments];
    if (!segs.length) return;
    const arr = state.localHistory.get(boardId) || [];
    let hashes = state.localHistoryHashes.get(boardId);
    if (!hashes) {
      hashes = new Set();
      state.localHistoryHashes.set(boardId, hashes);
    }
    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const key = createSegmentHash(seg);
      if (hashes.has(key)) continue;
      hashes.add(key);
      arr.push(seg);
    }
    if (arr.length > LOCAL_HISTORY_LIMIT) {
      const overflow = arr.length - LOCAL_HISTORY_LIMIT;
      const removed = arr.splice(0, overflow);
      if (removed.length && hashes.size) {
        for (const seg of removed) {
          const key = createSegmentHash(seg);
          hashes.delete(key);
        }
      }
    }
    state.localHistory.set(boardId, arr);
  }

  function clearLocalHistory(boardId) {
    if (!boardId) return;
    state.localHistory.delete(boardId);
    state.localHistoryHashes.delete(boardId);
  }

  function restoreLocalHistory(boardId) {
    if (!boardId) return;
    try{
      const segs = state.localHistory.get(boardId);
      if (Array.isArray(segs) && segs.length) {
        handleRemoteStroke(segs, { store: false });
      }
    }catch(_){ /* ignore restore errors */ }
  }

  function getOrCreateClientId() {
    if (!isBrowser) return createUid('client');
    try {
      const key = 'studyflow:whiteboard:clientId';
      let value = window.localStorage ? window.localStorage.getItem(key) : null;
      if (!value) {
        value = createUid('client');
        if (window.localStorage) {
          window.localStorage.setItem(key, value);
        }
      }
      return value;
    } catch (err) {
      return createUid('client');
    }
  }

  function getLocalCursorName() {
    if (state.user && state.user.displayName) return state.user.displayName;
    if (state.user && state.user.email) {
      return state.user.email.split('@')[0];
    }
    return 'You';
  }

  function init() {
    if (!isBrowser) return;
    state.stageEl = document.getElementById('whiteboardStage');
    state.canvasEl = document.getElementById('whiteboardCanvas');
    state.cursorContainer = document.getElementById('whiteboardCursors');
    if (!state.stageEl || !state.cursorContainer) {
      return;
    }
    if (state.canvasEl && !state.ctx) {
      state.ctx = state.canvasEl.getContext('2d');
      if (state.ctx) {
        state.ctx.lineCap = 'round';
        state.ctx.lineJoin = 'round';
      }
    }
    if (!state.clientId) {
      state.clientId = getOrCreateClientId();
    }
    if (!state.overlay) {
      state.overlay = new CursorOverlay(state.cursorContainer, state.transform, {
        stage: state.stageEl,
        defaultBrushRadius: state.brush.radius,
        defaultColor: state.brush.color,
        localName: getLocalCursorName()
      });
      state.overlay.start();
    }
    if (!state.listenersAttached) {
      attachEventListeners();
      state.listenersAttached = true;
    }
    state.initialized = true;
  }

  // --- Lightweight UI: history loading indicator ---
  function showHistoryLoading() {
    try {
      if (state.loadingEl) return;
      const meta = document.getElementById('whiteboardMeta');
      if (!meta) return;
      const el = document.createElement('span');
      el.className = 'wb-history-loading';
      el.textContent = 'Loading history…';
      // Minimal inline styling to avoid CSS edits
      el.style.marginLeft = '8px';
      el.style.padding = '2px 8px';
      el.style.borderRadius = '9999px';
      el.style.fontSize = '12px';
      el.style.lineHeight = '16px';
      el.style.background = 'var(--chip-bg, #eef2ff)';
      el.style.color = 'var(--muted, #6b7280)';
      el.style.border = '1px solid rgba(0,0,0,0.05)';
      el.setAttribute('aria-live', 'polite');
      meta.appendChild(el);
      state.loadingEl = el;
      // Fallback auto-hide in case something gets stuck
      if (state.loadingTimer) { try { clearTimeout(state.loadingTimer); } catch(_){} }
      state.loadingTimer = setTimeout(() => hideHistoryLoading(), 15000);
    } catch(_) { /* ignore */ }
  }

  function hideHistoryLoading() {
    try {
      if (state.loadingTimer) { clearTimeout(state.loadingTimer); state.loadingTimer = null; }
      if (state.loadingEl && state.loadingEl.parentNode) {
        state.loadingEl.parentNode.removeChild(state.loadingEl);
      }
      state.loadingEl = null;
    } catch(_) { /* ignore */ }
  }

  function attachEventListeners() {
    if (!state.stageEl) return;
    const stage = state.stageEl;
    stage.addEventListener('pointerdown', handlePointerDown);
    stage.addEventListener('pointermove', handlePointerMove, { passive: true });
    stage.addEventListener('pointerup', handlePointerUp);
    stage.addEventListener('pointercancel', handlePointerUp);
    stage.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('resize', handleResize);

    const colorInput = document.getElementById('whiteboardColor');
    if (colorInput) {
      colorInput.addEventListener('input', handleBrushColorChange);
    }
    const sizeInput = document.getElementById('whiteboardSize');
    if (sizeInput) {
      sizeInput.addEventListener('input', handleBrushSizeChange);
    }

    // Tool buttons
    const toolbar = document.getElementById('whiteboardToolbar');
    if (toolbar) {
      toolbar.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-tool]') : null;
        if (!btn) return;
        const tool = btn.getAttribute('data-tool');
        if (!tool) return;
        setTool(tool);
        // update active class
        const buttons = toolbar.querySelectorAll('.whiteboard-tool');
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
      });
    }
  }

  function handleBrushColorChange(event) {
    const value = event && event.target ? event.target.value : null;
    if (!value) return;
    state.brush.color = value;
    if (state.overlay) {
      state.overlay.setLocalBrush({ color: value, name: getLocalCursorName() });
    }
    if (state.networking) {
      state.networking.updateColor(value);
    }
  }

  function handleBrushSizeChange(event) {
    const value = event && event.target ? Number(event.target.value) : NaN;
    if (!Number.isFinite(value)) return;
    state.brush.radius = value;
    if (state.overlay) {
      state.overlay.setLocalBrush({ radius: value, name: getLocalCursorName() });
    }
    if (state.networking) {
      state.networking.updateBrush(value);
    }
  }

  function handlePointerDown(event) {
    if (!state.stageEl) return;
    state.pointerDown = true;
    state.lastCanvasPoint = getCanvasPointFromEvent(event);
    if (event.pointerId != null && event.target && event.target.setPointerCapture) {
      try { event.target.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    handlePointerMove(event);
  }

  function handlePointerMove(event) {
    if (!state.stageEl || !state.overlay) return;
    const rect = state.stageEl.getBoundingClientRect();
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    let lastWorld = null;
    for (const e of events) {
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      lastWorld = state.transform.screenToWorld({ x: screenX, y: screenY });
      // Draw on canvas using canvas pixel coordinates
      if (state.pointerDown && state.ctx && state.canvasEl) {
        const p = getCanvasPointFromEvent(e);
        drawLineTo(p);
      }
    }
    if (!lastWorld) return;
    state.localPointerWorld = lastWorld;
    state.lastPointerMove = now();
    const name = getLocalCursorName();
    state.overlay.setLocalBrush({ radius: state.brush.radius, color: state.brush.color, name });
    state.overlay.setLocalTarget(lastWorld);
    state.overlay.setLocalVisible(true);
    if (state.networking) {
      state.networking.updateLocalCursor({
        x: lastWorld.x,
        y: lastWorld.y,
        brushRadius: state.brush.radius,
        color: state.brush.color
      });
    }
  }

  function handlePointerUp(event) {
    state.pointerDown = false;
    state.lastCanvasPoint = null;
    if (event.pointerId != null && event.target && event.target.releasePointerCapture) {
      try { event.target.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    if (state.networking) {
      state.networking.flush();
      state.networking.pokeIdle();
    }
    // persist any remaining batch promptly
    if (state.dbFlushTimer) { clearTimeout(state.dbFlushTimer); state.dbFlushTimer = null; }
    flushDbBatch();
  }

  function handlePointerLeave() {
    if (state.overlay) {
      state.overlay.setLocalVisible(false);
    }
    if (state.networking) {
      state.networking.pokeIdle();
    }
  }

  function getCanvasPointFromEvent(e) {
    if (!state.canvasEl) return { x: 0, y: 0 };
    const rect = state.canvasEl.getBoundingClientRect();
    const scaleX = state.canvasEl.width / rect.width;
    const scaleY = state.canvasEl.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return { x, y };
  }

  function drawLineTo(p) {
    const ctx = state.ctx; if (!ctx) return;
    const prev = state.lastCanvasPoint || p;
    const tool = state.tool || 'pen';
    ctx.save();
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = Math.max(2, state.brush.radius * 2);
      ctx.globalAlpha = 1;
    } else if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = state.brush.color;
      ctx.lineWidth = Math.max(2, state.brush.radius * 1.6);
      ctx.globalAlpha = 0.35;
    } else { // pen
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = state.brush.color;
      ctx.lineWidth = Math.max(1, state.brush.radius);
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
    state.lastCanvasPoint = p;

    // Broadcast stroke segment to others
    if (state.networking) {
      const payload = {
        x1: prev.x, y1: prev.y,
        x2: p.x, y2: p.y,
        color: state.brush.color,
        width: tool === 'eraser' ? Math.max(2, state.brush.radius * 2)
              : tool === 'highlighter' ? Math.max(2, state.brush.radius * 1.6)
              : Math.max(1, state.brush.radius),
        alpha: tool === 'highlighter' ? 0.35 : (tool === 'eraser' ? 1 : 1),
        op: tool === 'eraser' ? 'destination-out' : 'source-over',
        tool
      };
      // Queue locally for batched network send and DB persistence
      queueStrokeSegment(payload);
    }
  }

  function clearCanvas() {
    if (state.ctx && state.canvasEl) {
      state.ctx.clearRect(0, 0, state.canvasEl.width, state.canvasEl.height);
    }
  }

  function broadcastClear(){
    if (state.networking) {
      state.networking.send({ type: 'control', payload: { action: 'clear', ts: Date.now() } });
    }
    // Also clear local fallback for this board
    try{ clearLocalHistory(state.boardId); }catch(_){ }
  }

  async function clearPersisted(){
    // Remove persisted strokes for current board from Firebase if available
    if (!state.boardId) return;
    try{
      if (!isFirebaseDbAvailable()) return;
      const db = getDb(); if (!db) return;
      const base = window.firebase.ref(db, `whiteboards/${state.boardId}/strokes`);
      await window.firebase.remove(base);
    }catch(_){ /* ignore */ }
    // Clear local fallback as well
    try{ clearLocalHistory(state.boardId); }catch(_){ }
  }

  function setTool(tool) {
    if (!tool) return; const allowed = ['pen', 'highlighter', 'eraser'];
    if (allowed.includes(tool)) { state.tool = tool; }
  }

  function handleResize() {
    if (state.overlay) {
      state.overlay.resize();
    }
  }

  function handleRemoteCursor(payload) {
    if (!payload || payload.userId === state.identity) return;
    if (!state.overlay) return;
    if (typeof payload.x !== 'number' || typeof payload.y !== 'number') {
      state.overlay.updateRemoteMeta(payload.userId, payload);
      return;
    }
    state.overlay.upsertRemoteCursor(payload.userId, payload);
  }

  function handlePresence(payload) {
    if (!payload || payload.userId === state.identity) return;
    if (!state.overlay) return;
    const action = payload.action;
    if (action === 'leave') {
      state.overlay.removeRemote(payload.userId);
      return;
    }
    if (action === 'idle') {
      state.overlay.setRemoteIdle(payload.userId, true);
      return;
    }
    if (action === 'active') {
      state.overlay.updateRemoteMeta(payload.userId, payload);
      state.overlay.setRemoteIdle(payload.userId, false);
      return;
    }
    if (action === 'join') {
      state.overlay.updateRemoteMeta(payload.userId, Object.assign({}, payload, { idle: true }));
    }
  }

  function handleRemoteStroke(payload, options = {}) {
    if (!payload || !state.ctx) return;
    const drawOne = (seg) => {
      if (!seg) return;
      const ctx = state.ctx;
      ctx.save();
      ctx.globalCompositeOperation = seg.op || 'source-over';
      ctx.strokeStyle = seg.color || '#2e2e2e';
      ctx.lineWidth = Math.max(1, Number(seg.width) || 2);
      ctx.globalAlpha = typeof seg.alpha === 'number' ? seg.alpha : 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
      ctx.closePath();
      ctx.restore();
    };
    const segments = Array.isArray(payload) ? payload : [payload];
    for (const seg of segments) drawOne(seg);
    if (options.store !== false) {
      appendToLocalHistory(state.boardId, segments);
    }
  }

  function handleControlMessage(payload){
    if (!payload) return;
    if (payload.action === 'clear') {
      clearCanvas();
      try{ clearLocalHistory(state.boardId); }catch(_){ }
    }
  }

  // ---------- Stroke batching & Firebase persistence ----------
  function queueStrokeSegment(seg){
    // For network: batch into short interval packet
    state.strokeBatch.push(seg);
    if (!state.strokeBatchTimer) {
      state.strokeBatchTimer = setTimeout(()=>{
        const batch = state.strokeBatch.splice(0, state.strokeBatch.length);
        state.strokeBatchTimer = null;
        if (state.networking) {
          if (batch.length === 1) state.networking.sendStroke(batch[0]);
          else state.networking.sendStrokeBatch(batch);
        }
      }, state.strokeBatchIntervalMs);
    }
    // For DB persistence: coalesce into slightly larger batches
    state.dbBatch.push(seg);
    // Keep local fallback per-board as well (session only)
    try{
      appendToLocalHistory(state.boardId, seg);
    }catch(_){ }
    if (!state.dbFlushTimer) {
      state.dbFlushTimer = setTimeout(()=>{
        state.dbFlushTimer = null;
        flushDbBatch();
      }, state.dbFlushIntervalMs);
    }
  }

  function isFirebaseDbAvailable(){
    try{
      if (!isBrowser) return false;
      const fb = window.firebase;
      if (!fb || typeof fb.getDatabase !== 'function' || !fb._app) return false;
      const hasUrl = fb._app && fb._app.options && fb._app.options.databaseURL;
      return !!hasUrl;
    }catch(_){ return false; }
  }

  function getDb(){
    try{ return window.firebase.getDatabase(window.firebase._app); }catch(_){ return null; }
  }

  function attachFirebaseStrokeStream(boardId){
    if (!isFirebaseDbAvailable()) return;
    const db = getDb(); if (!db) return;
    detachFirebaseStrokeStream();
    const base = window.firebase.ref(db, `whiteboards/${boardId}/strokes`);
    state.dbRef = base;
    state.dbSeenNodes.clear();
    try{
      showHistoryLoading();
      window.firebase.get(base).then((snap)=>{
        try{
          const data = snap && typeof snap.forEach === 'function' ? snap : null;
          if (data){
            const segsAll = [];
            data.forEach((child)=>{
              try{
                const key = child && (child.key || (child.ref && child.ref.key));
                if(key) state.dbSeenNodes.add(key);
                const val = child && typeof child.val === 'function' ? child.val() : (child && child.val) ? child.val : null;
                if (!val || (val.senderId && val.senderId === state.clientId)) return;
                if (Array.isArray(val.segments)) segsAll.push(...val.segments);
              }catch(_){ }
            });
            if (segsAll.length) handleRemoteStroke(segsAll);
          }
        }catch(_){ }
      }).catch((_err)=>{
        state.dbWritesDisabled = true;
      }).finally(() => {
        hideHistoryLoading();
      });
    }catch(_){ }
    state.dbUnsubscribe = window.firebase.onChildAdded(base, (snap)=>{
      try{
        const key = snap && (snap.key || (snap.ref && snap.ref.key));
        if(key && state.dbSeenNodes.has(key)) return;
        if(key) state.dbSeenNodes.add(key);
        const val = snap && typeof snap.val === 'function' ? snap.val() : (snap && snap.val) ? snap.val : null;
        if (!val) return;
        if (val.senderId && val.senderId === state.clientId) return;
        const segs = Array.isArray(val.segments) ? val.segments : [];
        if (segs.length) handleRemoteStroke(segs);
      }catch(e){ /* ignore draw errors */ }
    });
  }

  function detachFirebaseStrokeStream(){
    try{
      if (state.dbUnsubscribe) { state.dbUnsubscribe(); state.dbUnsubscribe = null; }
      if (state.dbRef) { window.firebase.off(state.dbRef); state.dbRef = null; }
      state.dbSeenNodes.clear();
      hideHistoryLoading();
    }catch(_){ /* noop */ }
  }

  async function flushDbBatch(){
    if (!state.dbBatch.length) return;
    if (state.dbWritesDisabled) { state.dbBatch.length = 0; return; }
    if (!isFirebaseDbAvailable() || !state.boardId) { state.dbBatch.length = 0; return; }
    const db = getDb(); if (!db) { state.dbBatch.length = 0; return; }
    const base = state.dbRef || window.firebase.ref(db, `whiteboards/${state.boardId}/strokes`);
    const payload = { senderId: state.clientId, ts: Date.now(), segments: state.dbBatch.splice(0, state.dbBatch.length) };
    try {
      const node = window.firebase.push(base);
      await window.firebase.set(node, payload);
      try{
        if(!(window.DB && window.DB.whiteboardPersistDisabled)){
          const metaRef = window.firebase.ref(db, `whiteboards_meta/${state.boardId}`);
          await window.firebase.update(metaRef, { lastActive: Date.now(), updatedAt: Date.now() });
        }
      }catch(_){ }
    } catch (e) {
      // If write fails (offline/unconfigured), drop batch silently
      state.dbWritesDisabled = true;
    }
  }
  function joinBoard(boardId, options = {}) {
    init();
    const identifier = options.userId || (state.user && state.user.uid) || state.clientId;
    state.identity = identifier;
    if (state.boardId === boardId) {
      if (state.networking) {
        state.networking.updateProfile({ name: getLocalCursorName(), color: state.brush.color });
      }
      return;
    }
    if (state.networking) {
      state.networking.destroy();
      state.networking = null;
    }
    // Detach any Firebase listeners from prior board
    detachFirebaseStrokeStream();
    if (!boardId) {
      state.boardId = null;
      if (state.overlay) state.overlay.clearRemotes();
      return;
    }
    state.boardId = boardId;
    try{
      if(isFirebaseDbAvailable() && !(window.DB && window.DB.whiteboardPersistDisabled)){
        const dbLive = getDb();
        if(dbLive){
          const metaRef = window.firebase.ref(dbLive, `whiteboards_meta/${boardId}`);
          window.firebase.update(metaRef, { lastActive: Date.now(), updatedAt: Date.now() }).catch(()=>{});
        }
      }
    }catch(_){ }
    // New board starts with a blank canvas; history will load shortly
    clearCanvas();
    if (state.overlay) state.overlay.clearRemotes();
    restoreLocalHistory(boardId);
    state.networking = new CursorNetworking({
      boardId,
      userId: identifier,
      name: getLocalCursorName(),
      color: state.brush.color,
      brushRadius: state.brush.radius,
      clientId: state.clientId,
      onCursor: handleRemoteCursor,
      onPresence: handlePresence,
      onStroke: handleRemoteStroke,
      onControl: handleControlMessage
    });
    // Attach Firebase stream to load history and future persisted strokes (if available)
    if (isFirebaseDbAvailable()) {
      state.dbWritesDisabled = false; // try again for this board
      attachFirebaseStrokeStream(boardId);
    }
  }

  function leaveBoard() {
    if (state.networking) {
      state.networking.destroy();
      state.networking = null;
    }
    detachFirebaseStrokeStream();
    state.boardId = null;
    if (state.overlay) {
      state.overlay.clearRemotes();
    }
    hideHistoryLoading();
  }

  function setBrushSettings(settings = {}) {
    if (typeof settings.radius === 'number') {
      state.brush.radius = settings.radius;
    }
    if (settings.color) {
      state.brush.color = settings.color;
    }
    if (state.overlay) {
      state.overlay.setLocalBrush({
        radius: state.brush.radius,
        color: state.brush.color,
        name: getLocalCursorName()
      });
    }
    if (state.networking) {
      state.networking.updateBrush(state.brush.radius);
      state.networking.updateColor(state.brush.color);
    }
  }

  function updateViewTransform(transform) {
    state.transform.set(transform || {});
    if (state.overlay) {
      state.overlay.setTransform(state.transform);
      state.overlay.resize();
    }
  }

  function handleAuth(user) {
    state.user = user || null;
    const name = getLocalCursorName();
    if (state.overlay) {
      state.overlay.setLocalBrush({ name });
    }
    if (state.networking) {
      state.networking.updateProfile({ name });
    }
  }

  function onActivated() {
    init();
    if (state.overlay) {
      state.overlay.resize();
    }
  }

  const Whiteboard = {
    init,
    onActivated,
    handleAuth,
    join: joinBoard,
    leave: leaveBoard,
    updateBrush: setBrushSettings,
    updateTransform: updateViewTransform,
    clear: clearCanvas,
    clearForAll: broadcastClear,
    clearPersisted,
    setTool,
    getClientId: () => state.clientId,
    getCurrentBoard: () => state.boardId
  };

  if (isBrowser) {
    global.Whiteboard = Whiteboard;
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(init, 0);
    } else {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    }
  }

  const __internals = {
    createThrottledSender,
    ViewTransform,
    clampLabelRect,
    contrastColor,
    parseHexColor
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      Whiteboard,
      __internals
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
