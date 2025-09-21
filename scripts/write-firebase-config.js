// scripts/write-firebase-config.js
// Writes assets/js/firebase-config.js from environment variables (for Cloudflare Pages builds).
// Exits with non-zero code if required env vars are missing so the build fails early.

const fs = require('fs');
const path = require('path');

const outPath = path.join(process.cwd(), 'assets', 'js', 'firebase-config.js');
const required = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_DATABASE_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID'
];

const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables for Firebase config:', missing.join(', '));
  console.error('Set them in Cloudflare Pages (Settings → Environment variables) and re-run the build.');
  process.exit(1);
}

const cfg = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || ''
};

const content = `// This file is generated at build time by scripts/write-firebase-config.js
window.__FIREBASE_CONFIG__ = ${JSON.stringify(cfg, null, 2)};
`;

try {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, { encoding: 'utf8' });
  console.log('Wrote', outPath);
  process.exit(0);
} catch (err) {
  console.error('Failed to write firebase-config.js', err);
  process.exit(2);
}
