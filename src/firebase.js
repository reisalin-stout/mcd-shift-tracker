// Firebase SDK setup: the ONE place that reads the VITE_FIREBASE_* variables (from .env.local, or from the GitHub
// Actions variables in the deploy build). Everything else talks to Firebase through src/backend/.
//
// If the variables are missing the app still starts (the shift tracker is fully local), `configured` is false and
// the Account page explains what to do, instead of the whole site crashing on a missing config.
import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
// What the app really needs (storage bucket and sender id are only used by Firebase features we do not use yet)
const REQUIRED = { apiKey: 'VITE_FIREBASE_API_KEY', authDomain: 'VITE_FIREBASE_AUTH_DOMAIN', databaseURL: 'VITE_FIREBASE_DATABASE_URL', projectId: 'VITE_FIREBASE_PROJECT_ID', appId: 'VITE_FIREBASE_APP_ID' };
// Names of the missing environment variables (shown on the Account page)
export const missingConfig = Object.entries(REQUIRED).filter(([k]) => !firebaseConfig[k]).map(([, name]) => name);
export const configured = missingConfig.length === 0;

export const app = configured ? initializeApp(firebaseConfig) : null;
// Login is kept on the device (IndexedDB, with localStorage as a fallback) until the person logs out
export const auth = app ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }) : null;
export const database = app ? getDatabase(app) : null;
