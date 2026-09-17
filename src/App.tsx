import { useEffect, useState } from "react";
import { onValue, ref, set } from "firebase/database";
import { getToken, onMessage } from "firebase/messaging";
import {
  database,
  firebaseConfigured,
  firebaseVapidKey,
  firebaseVapidKeyValid,
  messaging,
} from "./firebase";
import "./App.css";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function App() {
  const [isOn, setIsOn] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [status, setStatus] = useState("Ready for setup");
  const [busy, setBusy] = useState(false);
  const [deviceName, setDeviceName] = useState(
    () => localStorage.getItem("signal-lab-device-name") ?? "My device",
  );
  const [messageText, setMessageText] = useState(
    "This is a notification test from Signal Lab.",
  );
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) {
      setStatus("Chrome menu → Install Signal Lab");
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setStatus(
      choice.outcome === "accepted"
        ? "Signal Lab installed"
        : "Install cancelled",
    );
    setInstallPrompt(null);
  }

  useEffect(() => {
    if (!firebaseConfigured || !database) return;
    return onValue(
      ref(database, "testState/isOn"),
      (snapshot) => {
        setIsOn(snapshot.val() === true);
        setStatus("Connected to shared state");
      },
      () => setStatus("Could not read shared state"),
    );
  }, []);

  useEffect(() => {
    if (!messaging) return;
    return onMessage(messaging, async (payload) => {
      const data = payload.data ?? {};
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(data.title ?? "Signal Lab test", {
        body: data.body ?? "A test notification arrived.",
        icon: "/icon-192.svg",
        tag: data.eventId ? `signal-${data.eventId}` : undefined,
        data: { url: data.url ?? "/", eventId: data.eventId ?? "unknown" },
      });
      setStatus(
        `Notification received · ID ${(data.eventId ?? "unknown").slice(0, 8)}`,
      );
    });
  }, []);

  async function toggleState() {
    if (!database) {
      setIsOn((value) => !value);
      setStatus("Preview mode: add Firebase config to sync devices");
      return;
    }
    setBusy(true);
    try {
      await set(ref(database, "testState/isOn"), !isOn);
      setStatus("Shared state updated");
    } catch {
      setStatus("State update failed; check Firebase rules");
    } finally {
      setBusy(false);
    }
  }

  async function enableNotifications() {
    if (!messaging) {
      setStatus("Add Firebase config before enabling notifications");
      return;
    }
    if (!firebaseVapidKey || !firebaseVapidKeyValid) {
      setStatus(
        "Invalid VAPID key: copy the public key from Firebase Cloud Messaging",
      );
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("This browser does not support web notifications");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notification permission was not granted");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js",
      );
      await registration.update();
      await navigator.serviceWorker.ready;
      const token = await getToken(messaging, {
        vapidKey: firebaseVapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token) throw new Error("FCM returned an empty device token");
      const response = await fetch("/api/register-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, deviceName }),
      });
      if (!response.ok) throw new Error("registration failed");
      setDeviceReady(true);
      setStatus("Notifications enabled on this device");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown browser error";
      setStatus(`Could not register device: ${detail.slice(0, 90)}`);
    }
  }

  async function sendNotification() {
    const message = messageText.trim();
    const sender = deviceName.trim() || "Unnamed device";
    if (!message) {
      setStatus("Write a message before sending");
      return;
    }
    localStorage.setItem("signal-lab-device-name", sender);
    setBusy(true);
    try {
      const response = await fetch("/api/send-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sender }),
      });
      const result = (await response.json()) as {
        message?: string;
        error?: string;
      };
      setStatus(
        response.ok
          ? (result.message ?? "Notification sent")
          : (result.error ?? "Notification failed"),
      );
    } catch {
      setStatus("Send endpoint unavailable. Deploy the Vercel API first.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">↗</span>
          <span>signal / lab</span>
        </div>
        <span className={`connection ${firebaseConfigured ? "online" : ""}`}>
          <span />
          {firebaseConfigured ? "Firebase ready" : "Preview mode"}
        </span>
        <button className="install-button" type="button" onClick={installApp}>
          Install app ↓
        </button>
      </header>
      <section className="intro">
        <p className="eyebrow">NOTIFICATION TEST CONSOLE · 01</p>
        <h1>
          Send a pulse.
          <br />
          <em>See it land.</em>
        </h1>
        <p className="lede">
          One shared signal across every installed device. Flip the state here,
          then wake the network with a real push.
        </p>
      </section>
      <section className="control-grid">
        <article className={`state-panel ${isOn ? "active" : ""}`}>
          <div className="panel-label">
            <span>Shared signal</span>
            <span>LIVE STATE</span>
          </div>
          <div className="state-readout">
            <span className="state-dot" />
            <strong>{isOn ? "ON" : "OFF"}</strong>
          </div>
          <p>
            {isOn
              ? "The signal is active across connected devices."
              : "The signal is quiet across connected devices."}
          </p>
          <button
            className="toggle"
            type="button"
            onClick={toggleState}
            disabled={busy}
            aria-pressed={isOn}
          >
            <span className="toggle-track">
              <span />
            </span>
            {isOn ? "Switch off" : "Switch on"}
          </button>
        </article>
        <article className="send-panel">
          <div className="panel-label">
            <span>Broadcast</span>
            <span>FCM PUSH</span>
          </div>
          <h2>
            Wake every
            <br />
            <em>device.</em>
          </h2>
          <p>
            Send your message to every registered installation, including
            devices with the app in the background.
          </p>
          <label className="field-label" htmlFor="message-text">
            Message
          </label>
          <textarea
            id="message-text"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            maxLength={240}
            rows={3}
          />
          <button
            className="send-button"
            type="button"
            onClick={sendNotification}
            disabled={busy}
          >
            <span>Send to all devices</span>
            <span className="arrow">→</span>
          </button>
        </article>
      </section>
      <section className="device-strip">
        <div>
          <span className="step">02</span>
          <strong>This device</strong>
          <p>Name it so the sender is easy to identify.</p>
        </div>
        <label className="device-name-field" htmlFor="device-name">
          <span>Device name</span>
          <input
            id="device-name"
            value={deviceName}
            onChange={(event) => {
              setDeviceName(event.target.value);
              localStorage.setItem(
                "signal-lab-device-name",
                event.target.value,
              );
            }}
            maxLength={40}
            placeholder="e.g. Windows desktop"
          />
        </label>
      </section>
      <section className="setup-strip">
        <div>
          <span className="step">01</span>
          <strong>Register this device</strong>
          <p>Allow notifications so this browser can receive the pulse.</p>
        </div>
        <button
          className={`register-button ${deviceReady ? "registered" : ""}`}
          type="button"
          onClick={enableNotifications}
        >
          {deviceReady ? "Device registered ✓" : "Enable notifications →"}
        </button>
      </section>
      <footer>
        <span>{status}</span>
        <span>HTTPS required · iPhone: add to Home Screen</span>
      </footer>
    </main>
  );
}

export default App;
