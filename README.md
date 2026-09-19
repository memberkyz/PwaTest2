## Molar/Care Dental Agenda

A mobile-first dental practice agenda for Maple Clinic with Google sign-in, a daily two-doctor schedule, week view, and patient directory.

## Setup

1. In Firebase Console, open the `pwa-realtime-demo` project and enable Authentication.
2. Under Authentication -> Sign-in method, enable Google and choose a support email.
3. Under Authentication -> Settings -> Authorized domains, add `pwa-test2-nine.vercel.app`.
4. Copy `.env.example` to `.env.local` and fill in the Firebase web config.
5. Add the same `VITE_FIREBASE_*` values to Vercel Production, Preview, and Development environments.
6. Deploy with `vercel deploy --prod --yes`.

The current production URL is https://pwa-test2-nine.vercel.app.

Google sign-in cannot work until steps 1-3 are completed in Firebase Console. Before those settings are enabled, Firebase returns `CONFIGURATION_NOT_FOUND`.

The service account is server-only. Never prefix it with `VITE_` and never commit it.

## Local development

```bash
npm run dev
```

The production URL is HTTPS and can be tested directly on a phone. On iPhone/iPad, open it in Safari, use Share -> Add to Home Screen, then open the installed PWA.

The current database rules are still from the original private notification prototype. Before storing real patient data, replace them with authenticated, user-scoped rules and move patient/appointment data from local demo arrays into the database.
