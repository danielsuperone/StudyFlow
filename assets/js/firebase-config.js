// assets/js/firebase-config.js
// Copy this file to provide your Firebase Web config to the app.
// IMPORTANT: Do NOT commit real keys to source control. Replace the placeholder values
// below with the values from your Firebase Console and keep this file local or add
// it to .gitignore.

// Example format — the loader expects `window.__FIREBASE_CONFIG__` to be set.
window.__FIREBASE_CONFIG__ = {
  apiKey: "AIzaSyC49gMe5p-dA-2_Lrwpa7aEN7hgB6qjxOc",
  authDomain: "studyflow-c3dac.firebaseapp.com",
  databaseURL: "https://studyflow-c3dac-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "studyflow-c3dac",
  storageBucket: "studyflow-c3dac.firebasestorage.app",
  messagingSenderId: "205515261043",
  appId: "1:205515261043:web:6eb3918264cc51954cd606",
  measurementId: "G-493KWP0LKS"
};

// How to use:
// 1) Fill in the values above from the Firebase Console (Project settings -> General).
// 2) Keep this file out of version control (add to .gitignore) or use an environment
//    specific mechanism to inject the config during deployment (Cloudflare Pages build
//    can write this file from secrets if you prefer).
// 3) The app will detect window.__FIREBASE_CONFIG__ and initialize the Firebase SDK.

/*
  CLOUDflare PAGES: how to inject Firebase config at build (recommended for production)

  Overview:
  - For local development you can keep this file (`assets/js/firebase-config.js`) with the values above.
  - For Cloudflare Pages production builds it's better to set the same values as environment variables in Pages and generate this file at build-time so you don't store credentials in the repo.

  1) Cloudflare Pages environment variable names (suggested):
    FIREBASE_API_KEY
    FIREBASE_AUTH_DOMAIN
    FIREBASE_DATABASE_URL
    FIREBASE_PROJECT_ID
    FIREBASE_STORAGE_BUCKET
    FIREBASE_MESSAGING_SENDER_ID
    FIREBASE_APP_ID
    FIREBASE_MEASUREMENT_ID  (optional)

  2) Add these variables in the Pages UI:
    - Go to Pages > your project > Settings > Environment variables (or the "Variables" tab)
    - Create the variables above and paste the corresponding values from your Firebase Console

  3) Build-time file generation (recommended): add a small step in your build command to write this file from the env vars.
    Example (bash) that you can prepend to your build command in Pages:

    # Bash example (Cloudflare Pages uses a Linux builder)
    cat > ./assets/js/firebase-config.js <<'EOF'
    window.__FIREBASE_CONFIG__ = {
     apiKey: "$FIREBASE_API_KEY",
     authDomain: "$FIREBASE_AUTH_DOMAIN",
     databaseURL: "$FIREBASE_DATABASE_URL",
     projectId: "$FIREBASE_PROJECT_ID",
     storageBucket: "$FIREBASE_STORAGE_BUCKET",
     messagingSenderId: "$FIREBASE_MESSAGING_SENDER_ID",
     appId: "$FIREBASE_APP_ID",
     measurementId: "$FIREBASE_MEASUREMENT_ID"
    };
    EOF

    Then run your normal build step (e.g., `npm run build` or similar).

  4) PowerShell variant (if you use PS in CI):

    $content = @"
    window.__FIREBASE_CONFIG__ = {
     apiKey: "${env:FIREBASE_API_KEY}",
     authDomain: "${env:FIREBASE_AUTH_DOMAIN}",
     databaseURL: "${env:FIREBASE_DATABASE_URL}",
     projectId: "${env:FIREBASE_PROJECT_ID}",
     storageBucket: "${env:FIREBASE_STORAGE_BUCKET}",
     messagingSenderId: "${env:FIREBASE_MESSAGING_SENDER_ID}",
     appId: "${env:FIREBASE_APP_ID}",
     measurementId: "${env:FIREBASE_MEASUREMENT_ID}"
    };
    "@
    $content | Out-File -FilePath ./assets/js/firebase-config.js -Encoding utf8

  5) Firebase Auth redirect domains
    - In Firebase Console > Authentication > Sign-in method > Authorized domains, add your Pages domain:
      <your-pages-subdomain>.pages.dev
     and add `localhost` if you plan to test locally.

  Notes:
  - Firebase Web config values (apiKey, authDomain, databaseURL, projectId...) are not secret in the same way server API keys are; they are safe to include client-side. However, generating the file from environment variables during build keeps you flexible and avoids committing project-specific files.
  - Keep server-side keys (OpenAI/OpenRouter API keys) only in Cloudflare Pages environment variables and never in client files.

  If you want, I can add a tiny helper script (Node) to write this file during builds and update your default Pages build command. Tell me if you prefer that and I will create `scripts/write-firebase-config.js` and show the exact Pages build command to use.
*/
