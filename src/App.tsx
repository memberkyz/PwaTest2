import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, firebaseConfigured, googleProvider } from "./firebase";
import DentalDashboard, { type DashboardUser } from "./DentalDashboard";
import PatientsPage, { type PatientFocus } from "./PatientsPage";
import { DOCTORS, type Patient } from "./clinic";
import logo from "./assets/logo-ui.png";
import "./App.css";

export type AppPage = "agenda" | "patients";

/** Single source of truth for the product name shown in the UI. */
export const APP_NAME = "Memo Dental";

/** Handed to the Patients page so it can book straight into the agenda. */
export interface ScheduleRequest {
  patientId: string;
  patient: Patient;
  date?: string;
  start?: string;
  laneId?: (typeof DOCTORS)[number]["id"];
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [localPreview, setLocalPreview] = useState(
    () =>
      import.meta.env.DEV &&
      sessionStorage.getItem("memodental-preview") === "true",
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
  // The naming step is no longer a hard gate: a new user can skip it and still
  // reach the agenda, which is what the clinic actually needs day to day.
  const [skippedDeviceName, setSkippedDeviceName] = useState(
    () => sessionStorage.getItem("memodental-name-skipped") === "true",
  );
  const needsDeviceName = !hasNamedDevice && !skippedDeviceName;
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  // Which workspace page is open. Both pages read the same Firebase nodes,
  // so switching between them never loses state.
  const [page, setPage] = useState<AppPage>("agenda");
  const [scheduleRequest, setScheduleRequest] =
    useState<ScheduleRequest | null>(null);
  // Selecting a patient from the agenda. The token makes each request
  // distinct so re-picking the same patient still re-focuses it.
  const [patientsFocus, setPatientsFocus] = useState<PatientFocus | null>(null);
  const focusTokenRef = useRef(0);

  const openPatientOnPatientsPage = useCallback((patientId: string) => {
    focusTokenRef.current += 1;
    setPatientsFocus({ id: patientId, token: focusTokenRef.current });
    setPage("patients");
  }, []);

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
      sessionStorage.removeItem("memodental-preview");
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

  // These must be declared before the early returns below, otherwise the
  // hooks order changes between the auth / naming screens and the workspace.
  const handleSchedule = useCallback((patientId: string, patient: Patient) => {
    setScheduleRequest({ patientId, patient });
    setPage("agenda");
  }, []);

  const clearScheduleRequest = useCallback(() => {
    setScheduleRequest(null);
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
    email: "preview@memodental.local",
    photoURL: null,
  };
  const activeUser: DashboardUser | null =
    user ?? (localPreview ? previewUser : null);

  if (!authReady) {
    return (
      <main className="auth-loading">
        <img className="brand-mark" src={logo} alt="" />
        <span>Loading {APP_NAME}</span>
      </main>
    );
  }

  if (!activeUser) {
    return (
      <main className="auth-shell">
        <section className="auth-visual">
          <div className="auth-brand">
            <img className="brand-mark" src={logo} alt="" />
            <span>memo dental</span>
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
              <em>Memo Dental.</em>
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
                  sessionStorage.setItem("memodental-preview", "true");
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
            <span>{APP_NAME} · 2026</span>
          </div>
        </section>
      </main>
    );
  }

  if (needsDeviceName) {
    return (
      <main className="name-shell">
        <div className="name-panel">
          <div className="auth-brand">
            <img className="brand-mark" src={logo} alt="" />
            <span>memo dental</span>
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
            where it came from. You can skip it and change it later.
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
              Enter {APP_NAME} <span>→</span>
            </button>
            <button
              className="quiet-sign-out"
              type="button"
              onClick={() => {
                sessionStorage.setItem("memodental-name-skipped", "true");
                setSkippedDeviceName(true);
                setStatus("Skipped device naming");
              }}
            >
              Skip for now
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

  if (page === "patients") {
    return (
      <PatientsPage
        onSchedule={handleSchedule}
        focusPatient={patientsFocus}
        headerAction={
          <button
            type="button"
            className="patients-back-button"
            onClick={() => setPage("agenda")}
          >
            <CalendarDays size={15} />
            <span>Agenda</span>
          </button>
        }
      />
    );
  }

  return (
    <DentalDashboard
      user={activeUser}
      deviceName={deviceName.trim() || activeUser.displayName || "Front desk"}
      authBusy={authBusy}
      onSignOut={signOutOfGoogle}
      onInstall={installApp}
      onOpenPatients={() => setPage("patients")}
      onOpenPatient={openPatientOnPatientsPage}
      pendingSchedule={scheduleRequest}
      onScheduleHandled={clearScheduleRequest}
    />
  );
}

export default App;
