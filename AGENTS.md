# Signal Lab Agent Handoff

## Project purpose

Signal Lab is a small cross-device PWA used to test shared state and web push notifications. The current working behavior is intentionally simple and reliable before building a larger app around it.

## Production

- Production URL: `https://pwa-test2-nine.vercel.app`
- Vercel project: `memo-fc3e/pwa-test2`
- Firebase project: `pwa-realtime-demo`
- Firebase web app ID: `1:34421066256:web:03ccdbf0fad2754b661895`
- Realtime Database: `pwa-realtime-demo-default-rtdb`, region `us-central1`
- Firebase Hosting exists but is not the production host; Vercel is the active deployment target.

## Architecture

- Frontend: React 19 + TypeScript + Vite.
- Shared state: Firebase Realtime Database at `testState/isOn`.
- Push registration: browser FCM token is obtained with the Firebase Web Push VAPID public key, then posted to `/api/register-device`.
- Device grouping: the Vercel endpoint subscribes tokens to the Firebase topic `signal-lab`.
- Broadcast: `/api/send-notification` uses Firebase Admin SDK and the server-only `FIREBASE_SERVICE_ACCOUNT_JSON` secret.
- Background notifications: `public/firebase-messaging-sw.js` uses Firebase Messaging compat scripts and displays data-only payloads.
- Foreground notifications: `src/App.tsx` uses Firebase `onMessage` and calls `showNotification` on the active service worker.
- PWA metadata: `public/manifest.webmanifest` and `public/icon-192.svg` / `public/icon-512.svg`.

## Notification contract

The send API creates a unique UUID and UTC timestamp for every send. It sends a data-only FCM payload containing:

- `eventId`
- `sentAt`
- `title`
- `body`
- `url`

The notification title includes the sender/device name. The body includes the custom message, shortened event ID, and UTC timestamp. The event ID is also used as the browser notification `tag` so duplicate behavior is easy to identify and the same event does not create multiple visible entries on one device.

Do not add an FCM `notification` payload unless the foreground/background handling is deliberately redesigned. The current data-only approach avoids automatic browser display plus manual display duplication.

## User-facing controls

- Shared ON/OFF switch updates Firebase Realtime Database.
- Message textarea controls the outgoing notification text.
- Device name input is stored in browser `localStorage` under `signal-lab-device-name` and is sent during registration and broadcast.
- Install button uses `beforeinstallprompt` where supported; otherwise it tells the user to use the browser install menu.

## Environment and secrets

- `.env.local` is ignored and must never be committed.
- `VITE_FIREBASE_*` values are public client configuration. `VITE_FIREBASE_VAPID_KEY` must be the Firebase Cloud Messaging Web Push **Key pair public key**, not the Web API key. A valid uncompressed VAPID public key decodes to 65 bytes.
- `FIREBASE_SERVICE_ACCOUNT_JSON` is server-only and must exist in Vercel Production environment variables as a Secret. Never put it in frontend code, a `VITE_*` variable, Git, or chat.
- `APP_URL` is the production URL used for notification click targets.
- The service worker has its own Firebase config because it is served as a public static file outside Vite environment injection.

## Firebase security state

`database.rules.json` currently allows public read/write only under `testState`. This is acceptable only for private testing. Before expanding the app or sharing it publicly, add Firebase Authentication and authenticated rules, then deploy with:

```powershell
firebase deploy --only database --project pwa-realtime-demo
```

## Important commands

```powershell
npm install
npm run dev
npm run build
npm run lint
vercel deploy --prod --yes
vercel logs pwa-test2-nine.vercel.app --limit 30
firebase deploy --only database --project pwa-realtime-demo
```

The Vercel prebuilt path has previously failed in this Windows environment with `spawn cmd.exe ENOENT`; use the normal `vercel deploy --prod --yes` path unless that tooling issue is intentionally revisited.

## Testing checklist

1. Open the production URL on Windows Chrome/Edge and on a supported phone.
2. Install the PWA where appropriate and grant notification permission.
3. Set a distinct device name on each device.
4. Register each device with **Enable notifications**.
5. Send one custom message.
6. Compare the event ID and UTC timestamp on every device.
7. Test once with apps foregrounded and once minimized/closed.
8. Check `vercel logs` if registration or sending fails.

## Change discipline

- Preserve the data-only notification contract and event ID unless testing a deliberate redesign.
- Keep Firebase Admin credentials server-side.
- Run `npm run build`, `npm run lint`, and the API TypeScript check after notification changes.
- Do not commit `.env.local`, `.vercel`, `dist`, `node_modules`, or Firebase service-account JSON files.
