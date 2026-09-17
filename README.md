## Signal Lab

A small PWA for testing shared state and web push notifications across devices.

## Setup

1. Create a Firebase project, enable Realtime Database, Cloud Messaging, and the web app.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web config and Web Push certificate key.
3. Put the same Firebase web config into `public/firebase-messaging-sw.js` where the `REPLACE_ME` values are shown.
4. Create a Firebase service-account JSON value and add it to Vercel as `FIREBASE_SERVICE_ACCOUNT_JSON`. Add the deployed URL as `APP_URL`.
5. Deploy with `npx vercel` or connect the folder to a Vercel project.

The service account is server-only. Never prefix it with `VITE_` and never commit it.

## Local development

```bash
npm run dev
```

Push notifications require HTTPS. Use the Vercel preview URL for device testing. On iPhone/iPad, open that URL in Safari, add it to the Home Screen, open the installed PWA, and enable notifications there.

The current `database.rules.json` intentionally allows access only to `testState` for this private notification test. Add Firebase Authentication and authenticated rules before sharing the URL publicly.

The Web Push certificate key is available in Firebase Console under Project settings, Cloud Messaging, Web configuration. It is required in `VITE_FIREBASE_VAPID_KEY` for device registration.
