Injecting Firebase config into Cloudflare Pages

This project expects `assets/js/firebase-config.js` to set `window.__FIREBASE_CONFIG__` before the Firebase loader runs.

Recommended approach (Cloudflare Pages):
1) Add these environment variables in your Pages project (Settings → Environment variables):
   - FIREBASE_API_KEY
   - FIREBASE_AUTH_DOMAIN
   - FIREBASE_DATABASE_URL
   - FIREBASE_PROJECT_ID
   - FIREBASE_STORAGE_BUCKET
   - FIREBASE_MESSAGING_SENDER_ID
   - FIREBASE_APP_ID
   - FIREBASE_MEASUREMENT_ID (optional)

2) Use the provided Node script to generate the file during the Pages build. In Cloudflare Pages set the Build command to:

   npm run build

   (The default `build` script runs `node scripts/write-firebase-config.js` then an echo. Replace the right-hand part with your actual build command if you have one.)

   Example full command if you have a static build step (bash):

   npm run write-config && npm run my-static-build

3) Ensure the output directory is correct (Pages defaults to the root for simple static sites), and deploy.

Verification:
- After a successful deploy, open `https://<your-pages-subdomain>.pages.dev/assets/js/firebase-config.js` and confirm it contains your values.
- In the browser console run:
    window.__FIREBASE_CONFIG__
  and then
    window.firebase && window.firebase._app
  The latter should be defined after the loader initializes.

If you prefer a different approach (inline in `index.html` or using a custom build script), adapt step 2 accordingly.

Server-side AI provider env vars (required for the `/api/ai` Pages Function):

- AI_PROVIDER (e.g. `openrouter` or `openai`)
- OPENROUTER_API_KEY (if using `openrouter`) - secret
- OPENAI_API_KEY (if using `openai`) - secret
- MODEL (recommended, e.g. `deepseek/deepseek-chat-v3.1:free`)
- AI_FAST_FALLBACK_MS (optional, e.g. `2000`)

Add these in Pages → Project → Settings → Environment variables. The Pages Function reads them at runtime and will return a helpful error if any required server-side secret is missing.
