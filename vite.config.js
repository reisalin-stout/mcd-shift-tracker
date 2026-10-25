import { defineConfig, loadEnv } from 'vite';

// Variables the Firebase features need (see .env.local.example). Missing ones do not stop the build: the app shows
// a "Firebase is not set up" notice instead. The warning is there so a deploy without them does not go unnoticed.
const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_DATABASE_URL', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];

// Relative base so it works on any GitHub Pages repo path.
export default defineConfig(({ mode, command }) => {
  if (command === 'build' && mode !== 'mock') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const missing = REQUIRED.filter((k) => !env[k]);
    if (missing.length) console.warn(`\n[firebase] Missing ${missing.join(', ')}: this build will show "Firebase is not set up".\n`);
  }
  return { base: './' };
});
