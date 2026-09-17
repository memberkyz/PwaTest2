/* Replace these values with the same Firebase web config used by the app. */
importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js",
);

firebase.initializeApp({
  apiKey: "AIzaSyBHOok3Y8Tw2vXXB-ne2IEZRbS17uV1p44",
  authDomain: "pwa-realtime-demo.firebaseapp.com",
  projectId: "pwa-realtime-demo",
  storageBucket: "pwa-realtime-demo.firebasestorage.app",
  messagingSenderId: "34421066256",
  appId: "1:34421066256:web:03ccdbf0fad2754b661895",
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || "Signal Lab test";
  const options = {
    body: data.body || "A test notification arrived.",
    icon: "/icon-192.svg",
    tag: data.eventId ? `signal-${data.eventId}` : undefined,
    data: { url: data.url || "/", eventId: data.eventId || "unknown" },
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});
