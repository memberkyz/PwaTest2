import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getMessaging, isSupported } from "firebase/messaging";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);
const app = firebaseConfigured ? initializeApp(config) : null;
export const database = app ? getDatabase(app) : null;
export const messaging =
  app && typeof window !== "undefined"
    ? await isSupported().then((supported) =>
        supported ? getMessaging(app) : null,
      )
    : null;
export const firebaseVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as
  | string
  | undefined;

export const firebaseVapidKeyValid = (() => {
  if (!firebaseVapidKey) return false;
  try {
    const normalized = firebaseVapidKey.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    return atob(padded).length === 65;
  } catch {
    return false;
  }
})();
