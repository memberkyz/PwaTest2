import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, firebaseConfigured, googleProvider } from "./firebase";
import DentalDashboard, { type DashboardUser } from "./DentalDashboard";
import "./App.css";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [localPreview, setLocalPreview] = useState(
    () =>
      import.meta.env.DEV &&
      sessionStorage.getItem("molar-care-preview") === "true",
  );
  const [authReady, setAuthReady] = useState(() => !auth);
  const [authBusy, setAuthBusy] = useState(false);
  const [status, setStatus] = useState("Ready for setup");
  const [deviceName, setDeviceName] = useState(
    () => localStorage.getItem("signal-lab-device-name") ?? "",
  );
  const [hasNamedDevice, setHasNamedDevice] = useState(() =>
    Boolean(localStorage.getItem("signal-lab-device-name")?.trim()),
  );
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, []);

  async function signInWithGoogle() {
    if (!auth) {
      setStatus("Add Firebase config before signing in");
      return;
    }
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      setStatus("Signed in with Google");
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "Unknown sign-in error";
      setStatus(`Google sign-in failed: ${code.slice(0, 80)}`);
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutOfGoogle() {
    if (localPreview) {
      sessionStorage.removeItem("molar-care-preview");
      setLocalPreview(false);
      setStatus("Local preview closed");
      return;
    }
    if (!auth) return;
    setAuthBusy(true);
    try {
      await signOut(auth);
      setStatus("Signed out");
    } catch {
      setStatus("Could not sign out");
    } finally {
      setAuthBusy(false);
    }
  }

  function saveDeviceName() {
    const name = deviceName.trim();
    if (!name) {
      setStatus("Give this device a name to continue");
      return;
    }
    localStorage.setItem("signal-lab-device-name", name);
    setDeviceName(name);
    setHasNamedDevice(true);
    setStatus("Device name saved");
  }

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  async function installApp(): Promise<string> {
    if (!installPrompt) {
      return "Use your browser menu → Add to Home Screen";
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      return choice.outcome === "accepted"
        ? "App installed"
        : "Install cancelled";
    } catch {
      return "Could not open the install prompt";
    }
  }

  const previewUser: DashboardUser = {
    displayName: "Dr. Maya Patel",
    email: "preview@molar-care.local",
    photoURL: null,
  };
  const activeUser: DashboardUser | null =
    user ?? (localPreview ? previewUser : null);

  if (!authReady) {
    return (
      <main className="auth-loading">
        <span className="brand-mark">↗</span>
        <span>Loading Molar/Care</span>
      </main>
    );
  }

  if (!activeUser) {
    return (
      <main className="auth-shell">
        <section className="auth-visual">
          <div className="auth-brand">
            <span className="brand-mark">↗</span>
            <span>
              molar<span>/</span>care
            </span>
          </div>
          <div className="signal-orbit" aria-hidden="true">
            <span className="orbit-ring orbit-ring-one" />
            <span className="orbit-ring orbit-ring-two" />
            <span className="orbit-core" />
            <span className="orbit-label">LIVE / 01</span>
          </div>
          <div className="auth-visual-copy">
            <span className="eyebrow">DENTAL CLINIC WORKSPACE</span>
            <h1>
              Keep your clinic
              <br />
              <em>moving.</em>
            </h1>
            <p>
              A calm, focused workspace for doctors, patients, and every
              appointment in between.
            </p>
          </div>
        </section>
        <section className="auth-card">
          <div className="auth-card-inner">
            <span className="auth-kicker">WELCOME BACK</span>
            <h2>
              Sign in to
              <br />
              <em>Molar/Care.</em>
            </h2>
            <p className="auth-copy">
              Use your Google account to open the clinic agenda and patient
              workspace.
            </p>
            <button
              className="google-button"
              type="button"
              onClick={signInWithGoogle}
              disabled={authBusy || !firebaseConfigured}
            >
              <span className="google-mark">G</span>
              <span>
                {authBusy ? "Opening Google..." : "Continue with Google"}
              </span>
              <span className="google-arrow">→</span>
            </button>
            {!firebaseConfigured && (
              <p className="auth-status">
                Add Firebase configuration to enable sign-in.
              </p>
            )}
            {import.meta.env.DEV && (
              <button
                className="local-preview-button"
                type="button"
                onClick={() => {
                  sessionStorage.setItem("molar-care-preview", "true");
                  setLocalPreview(true);
                  setStatus("Local preview mode");
                }}
              >
                Preview locally without signing in
              </button>
            )}
            {status !== "Ready for setup" && (
              <p className="auth-status">{status}</p>
            )}
            <p className="auth-legal">
              By continuing, you sign in securely with Google.
            </p>
          </div>
          <div className="auth-footer">
            <span>HTTPS required</span>
            <span>Molar/Care · 2026</span>
          </div>
        </section>
      </main>
    );
  }

  if (!hasNamedDevice) {
    return (
      <main className="name-shell">
        <div className="name-panel">
          <div className="auth-brand">
            <span className="brand-mark">↗</span>
            <span>
              molar<span>/</span>care
            </span>
          </div>
          <div className="name-progress">
            <span /> <span className="current" /> <span />
          </div>
          <span className="auth-kicker">ONE LAST DETAIL</span>
          <h1>
            What should we
            <br />
            <em>call this device?</em>
          </h1>
          <p className="name-copy">
            This name appears when you send a pulse, so your other devices know
            where it came from.
          </p>
          <form
            className="name-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveDeviceName();
            }}
          >
            <label className="field-label" htmlFor="welcome-device-name">
              Device name
            </label>
            <input
              id="welcome-device-name"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              maxLength={40}
              placeholder="e.g. Windows desktop"
              autoFocus
            />
            <button className="name-submit" type="submit">
              Enter Molar/Care <span>→</span>
            </button>
          </form>
          {status !== "Ready for setup" && (
            <p className="auth-status">{status}</p>
          )}
          <button
            className="quiet-sign-out"
            type="button"
            onClick={signOutOfGoogle}
            disabled={authBusy}
          >
            Use a different account
          </button>
        </div>
      </main>
    );
  }

  return (
    <DentalDashboard
      user={activeUser}
      deviceName={deviceName}
      authBusy={authBusy}
      onSignOut={signOutOfGoogle}
      onInstall={installApp}
    />
  );
}

export default App;
