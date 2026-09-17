import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

function getAdminMessaging() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccount)
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  const app =
    getApps()[0] ??
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
  return getMessaging(app);
}

export { getAdminMessaging };
