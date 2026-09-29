import { useEffect, useMemo, useRef, useState } from "react";
import { getToken, onMessage } from "firebase/messaging";
import {
  Bell,
  BellOff,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  MessageCircle,
  Phone,
  Plus,
  Search,
} from "lucide-react";
import { firebaseVapidKey, firebaseVapidKeyValid, messaging } from "./firebase";
import {
  DOCTORS,
  createAppointment,
  createTreatmentRecord,
  dateKey,
  deleteAppointment,
  fetchDayCounts,
  findOrCreatePatient,
  friendlyDate,
  getWeekDates,
  isSameDay,
  labelToMinutes,
  minutesToLabel,
  moveAppointment,
  relocateAppointment,
  saveDailyNote,
  subscribeToDay,
  subscribeToPatients,
  updatePatient,
  updateTreatmentRecord,
  type Appointment,
  type AppointmentMap,
  type DayAppointments,
  type DayCounts,
  type DayNotes,
  type DoctorId,
  type Patient,
  type PatientMap,
} from "./clinic";
import AppointmentModal, { type AppointmentDraft } from "./AppointmentModal";
import PatientProfile from "./PatientProfile";

function ToothIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3c-2.5 0-4.5 1.4-6 1.4C4.2 4.4 3 5.8 3 8c0 2.6.9 4.8 1.6 7.4.5 1.9.9 4.4 2.3 5.4.8.6 1.4-.6 1.7-1.6.4-1.4.6-3.6 2-3.6h2.8c1.4 0 1.6 2.2 2 3.6.3 1 .9 2.2 1.7 1.6 1.4-1 1.8-3.5 2.3-5.4C20.1 12.8 21 10.6 21 8c0-2.2-1.2-3.6-3-3.6-1.5 0-3.5-1.4-6-1.4Z" />
    </svg>
  );
}

function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

interface LayoutEntry {
  id: string;
  appointment: Appointment;
  col: number;
  cols: number;
}

// Packs overlapping appointments into side-by-side columns (like Google Calendar).
function layoutAppointments(map: AppointmentMap): LayoutEntry[] {
  const items = Object.entries(map)
    .map(([id, appointment]) => ({
      id,
      appointment,
      start: labelToMinutes(appointment.start),
      end: labelToMinutes(appointment.start) + appointment.duration,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const colOf: Record<string, number> = {};
  const clusterCols: Record<string, number> = {};
  let active: { id: string; col: number; end: number }[] = [];
  let clusterIds: string[] = [];
  let clusterSize = 0;

  const flushCluster = () => {
    for (const id of clusterIds) clusterCols[id] = clusterSize;
    clusterIds = [];
    clusterSize = 0;
  };

  for (const item of items) {
    active = active.filter((entry) => entry.end > item.start);
    if (active.length === 0) flushCluster();
    const usedCols = new Set(active.map((entry) => entry.col));
    let col = 0;
    while (usedCols.has(col)) col += 1;
    active.push({ id: item.id, col, end: item.end });
    colOf[item.id] = col;
    clusterIds.push(item.id);
    clusterSize = Math.max(clusterSize, active.length);
  }
  flushCluster();

  return items.map((item) => ({
    id: item.id,
    appointment: item.appointment,
    col: colOf[item.id],
    cols: clusterCols[item.id] ?? 1,
  }));
}

export interface DashboardUser {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

interface DentalDashboardProps {
  user: DashboardUser;
  deviceName: string;
  authBusy: boolean;
  onSignOut: () => void;
  onInstall: () => Promise<string>;
}

type DoctorFilter = "both" | DoctorId;
type ViewMode = "day" | "week";

const DAY_START_MINUTES = 7 * 60;
const DAY_END_MINUTES = 23 * 60;
const PX_PER_MINUTE = 1.4;
const BOARD_PADDING = 12;
const DRAG_THRESHOLD_PX = 6;
const CARD_GAP = 4;
const HOURS = Array.from(
  { length: (DAY_END_MINUTES - DAY_START_MINUTES) / 60 + 1 },
  (_, index) => DAY_START_MINUTES + index * 60,
);

interface DragState {
  fromDoctorId: DoctorId;
  id: string;
  pointerId: number;
  grabOffsetY: number;
  duration: number;
  startX: number;
  startY: number;
  isDragging: boolean;
  targetDoctorId: DoctorId;
  snappedMinutes: number;
}

type ModalState =
  | {
      mode: "create";
      doctorId: DoctorId;
      date: string;
      start: string;
      patientId?: string;
      patientName?: string;
      phone?: string;
    }
  | {
      mode: "edit";
      doctorId: DoctorId;
      date: string;
      id: string;
      appointment: Appointment;
    }
  | null;

export default function DentalDashboard({
  user,
  deviceName,
  authBusy,
  onSignOut,
  onInstall,
}: DentalDashboardProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [doctorFilter, setDoctorFilter] = useState<DoctorFilter>("both");
  const [query, setQuery] = useState("");
  const [appointments, setAppointments] = useState<DayAppointments>({
    berkay: {},
    kagan: {},
  });
  const [notes, setNotes] = useState<DayNotes>({ berkay: "", kagan: "" });
  const [weekCounts, setWeekCounts] = useState<Record<string, DayCounts>>({});
  const [modalState, setModalState] = useState<ModalState>(null);
  const [noteDraftDoctor, setNoteDraftDoctor] = useState<DoctorId | null>(null);
  const [noteDraftText, setNoteDraftText] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [patients, setPatients] = useState<PatientMap>({});
  const [searchFocused, setSearchFocused] = useState(false);
  const [openPatientId, setOpenPatientId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const justDraggedRef = useRef(false);

  const activeDateKey = useMemo(() => dateKey(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const visibleDoctors = useMemo(
    () =>
      doctorFilter === "both"
        ? DOCTORS
        : DOCTORS.filter((doctor) => doctor.id === doctorFilter),
    [doctorFilter],
  );

  useEffect(() => {
    setAppointments({ berkay: {}, kagan: {} });
    return subscribeToDay(activeDateKey, setAppointments, setNotes);
  }, [activeDateKey]);

  useEffect(() => subscribeToPatients(setPatients), []);

  useEffect(() => {
    if (viewMode !== "week") return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        weekDates.map(
          async (date) =>
            [dateKey(date), await fetchDayCounts(dateKey(date))] as const,
        ),
      );
      if (!cancelled) setWeekCounts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, weekDates]);

  async function ensureNotificationsEnabled() {
    if (!messaging || !firebaseVapidKey || !firebaseVapidKeyValid) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const registration = await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js",
      );
      await registration.update();
      await navigator.serviceWorker.ready;
      const token = await getToken(messaging, {
        vapidKey: firebaseVapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token) return;
      await fetch("/api/register-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, deviceName }),
      });
      setNotificationsReady(true);
    } catch {
      setNotificationsReady(false);
    }
  }

  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      void ensureNotificationsEnabled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!messaging) return;
    return onMessage(messaging, async (payload) => {
      const data = payload.data ?? {};
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(data.title ?? "Dental Agenda", {
          body: data.body ?? "An appointment changed.",
          icon: "/icon-192.svg",
          tag: data.eventId ? `agenda-${data.eventId}` : undefined,
        });
      } catch {
        // best effort; foreground toast is not critical
      }
    });
  }, []);

  function notifyChange(message: string) {
    void fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sender: deviceName || user.displayName || "Clinic",
      }),
    }).catch(() => {});
  }

  function doctorName(id: DoctorId): string {
    return DOCTORS.find((doctor) => doctor.id === id)?.name ?? id;
  }

  function shiftDate(deltaDays: number) {
    setSelectedDate((previous) => {
      const next = new Date(previous);
      next.setDate(previous.getDate() + deltaDays);
      return next;
    });
  }

  function handleDateInputChange(value: string) {
    if (!value) return;
    const [year, month, day] = value.split("-").map(Number);
    setSelectedDate(new Date(year, month - 1, day));
  }

  function matchesSearch(appointment: Appointment): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      appointment.patientName.toLowerCase().includes(q) ||
      appointment.phone.toLowerCase().includes(q)
    );
  }

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.entries(patients)
      .filter(
        ([, patient]) =>
          patient.name.toLowerCase().includes(q) ||
          patient.phone.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [patients, query]);

  function openPatientFromSearch(patientId: string) {
    setOpenPatientId(patientId);
    setQuery("");
    setSearchFocused(false);
  }

  function scheduleForPatient(patientId: string, patient: Patient) {
    setOpenPatientId(null);
    setModalState({
      mode: "create",
      doctorId: visibleDoctors[0]?.id ?? DOCTORS[0].id,
      date: activeDateKey,
      start: "09:00",
      patientId,
      patientName: patient.name,
      phone: patient.phone,
    });
  }

  function openCreateModal(doctorId: DoctorId, start: string) {
    setModalState({ mode: "create", doctorId, date: activeDateKey, start });
  }

  function openEditModal(
    doctorId: DoctorId,
    id: string,
    appointment: Appointment,
  ) {
    setModalState({
      mode: "edit",
      doctorId,
      date: activeDateKey,
      id,
      appointment,
    });
  }

  function handleColumnClick(
    event: React.MouseEvent<HTMLDivElement>,
    doctorId: DoctorId,
  ) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawMinutes =
      DAY_START_MINUTES +
      (event.clientY - rect.top - BOARD_PADDING) / PX_PER_MINUTE;
    const snapped = Math.min(
      Math.max(Math.round(rawMinutes / 15) * 15, DAY_START_MINUTES),
      DAY_END_MINUTES - 60,
    );
    openCreateModal(doctorId, minutesToLabel(snapped));
  }

  function handleDragStart(
    event: React.PointerEvent<HTMLElement>,
    doctorId: DoctorId,
    id: string,
    appointment: Appointment,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const card = event.currentTarget;
    card.setPointerCapture(event.pointerId);
    const cardRect = card.getBoundingClientRect();
    setDragState({
      fromDoctorId: doctorId,
      id,
      pointerId: event.pointerId,
      grabOffsetY: event.clientY - cardRect.top,
      duration: appointment.duration,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
      targetDoctorId: doctorId,
      snappedMinutes: labelToMinutes(appointment.start),
    });
  }

  function handleDragMove(event: React.PointerEvent<HTMLElement>) {
    setDragState((previous) => {
      if (!previous || previous.pointerId !== event.pointerId) return previous;
      const movedX = Math.abs(event.clientX - previous.startX);
      const movedY = Math.abs(event.clientY - previous.startY);
      const isDragging =
        previous.isDragging ||
        movedX > DRAG_THRESHOLD_PX ||
        movedY > DRAG_THRESHOLD_PX;
      if (!isDragging) return previous;

      const column = document
        .elementsFromPoint(event.clientX, event.clientY)
        .find(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            element.closest(".doctor-body") !== null,
        )
        ?.closest<HTMLElement>(".doctor-body");
      if (!column?.dataset.doctorId) return { ...previous, isDragging };

      const targetDoctorId = column.dataset.doctorId as DoctorId;
      const rect = column.getBoundingClientRect();
      const rawMinutes =
        DAY_START_MINUTES +
        (event.clientY - rect.top - previous.grabOffsetY - BOARD_PADDING) /
          PX_PER_MINUTE;
      const snappedMinutes = Math.min(
        Math.max(Math.round(rawMinutes / 15) * 15, DAY_START_MINUTES),
        DAY_END_MINUTES - 15,
      );
      return { ...previous, isDragging, targetDoctorId, snappedMinutes };
    });
  }

  function handleDragEnd(event: React.PointerEvent<HTMLElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = dragState;
    setDragState(null);
    if (!drag.isDragging) return;
    justDraggedRef.current = true;

    const appointment = appointments[drag.fromDoctorId]?.[drag.id];
    if (!appointment) return;
    const newStart = minutesToLabel(drag.snappedMinutes);
    if (
      drag.targetDoctorId === drag.fromDoctorId &&
      newStart === appointment.start
    ) {
      return;
    }
    const updated: Appointment = {
      ...appointment,
      start: newStart,
      updatedAt: Date.now(),
    };
    moveAppointment(
      activeDateKey,
      drag.fromDoctorId,
      drag.targetDoctorId,
      drag.id,
      updated,
    )
      .then(() => {
        if (updated.patientId) {
          void updateTreatmentRecord(updated.patientId, drag.id, {
            doctorId: drag.targetDoctorId,
          });
        }
        notifyChange(
          `${appointment.patientName} rescheduled to ${newStart} with ${doctorName(drag.targetDoctorId)}`,
        );
      })
      .catch(() => setStatusMessage("Could not reschedule the appointment"));
  }

  async function handleModalSave(draft: AppointmentDraft) {
    const appointment: Appointment = {
      patientName: draft.patientName.trim(),
      phone: draft.phone.trim(),
      treatment: draft.treatment.trim(),
      start: draft.start,
      duration: draft.duration,
      notes: draft.notes.trim(),
      updatedAt: Date.now(),
    };
    try {
      let patientId =
        modalState?.mode === "edit"
          ? modalState.appointment.patientId
          : modalState?.mode === "create"
            ? modalState.patientId
            : undefined;
      if (patientId) {
        await updatePatient(patientId, {
          name: appointment.patientName,
          phone: appointment.phone,
        });
      } else {
        patientId = await findOrCreatePatient(
          patients,
          appointment.patientName,
          appointment.phone,
        );
      }
      appointment.patientId = patientId;

      if (modalState?.mode === "edit") {
        await relocateAppointment(
          modalState.date,
          draft.date,
          modalState.doctorId,
          draft.doctorId,
          modalState.id,
          appointment,
        );
        await updateTreatmentRecord(patientId, modalState.id, {
          date: draft.date,
          doctorId: draft.doctorId,
          treatment: appointment.treatment,
          notes: appointment.notes,
        });
        notifyChange(
          `${appointment.patientName}'s appointment was updated (${doctorName(draft.doctorId)})`,
        );
      } else {
        const appointmentId = await createAppointment(
          draft.date,
          draft.doctorId,
          appointment,
        );
        await createTreatmentRecord(patientId, appointmentId, {
          date: draft.date,
          doctorId: draft.doctorId,
          treatment: appointment.treatment,
          notes: appointment.notes,
          appointmentId,
          createdAt: Date.now(),
        });
        notifyChange(
          `New appointment: ${appointment.patientName} with ${doctorName(draft.doctorId)} at ${appointment.start}`,
        );
      }
      setModalState(null);
    } catch {
      setStatusMessage("Could not save the appointment");
    }
  }

  async function handleModalDelete() {
    if (modalState?.mode !== "edit") return;
    const { doctorId, date, id, appointment } = modalState;
    try {
      if (appointment.patientId) {
        await updateTreatmentRecord(appointment.patientId, id, {
          cancelled: true,
        });
      }
      await deleteAppointment(date, doctorId, id);
      notifyChange(
        `${appointment.patientName}'s appointment with ${doctorName(doctorId)} was cancelled`,
      );
      setModalState(null);
    } catch {
      setStatusMessage("Could not cancel the appointment");
    }
  }

  function startEditNote(doctorId: DoctorId) {
    setNoteDraftDoctor(doctorId);
    setNoteDraftText(notes[doctorId] ?? "");
  }

  async function commitNote() {
    if (!noteDraftDoctor) return;
    const doctorId = noteDraftDoctor;
    const text = noteDraftText;
    setNoteDraftDoctor(null);
    try {
      await saveDailyNote(activeDateKey, doctorId, text);
    } catch {
      setStatusMessage("Could not save the daily note");
    }
  }

  const gridHeight =
    (DAY_END_MINUTES - DAY_START_MINUTES) * PX_PER_MINUTE + BOARD_PADDING * 2;

  return (
    <main className="agenda-app">
      <header className="agenda-topbar">
        <div className="agenda-brand">
          <span className="agenda-brand-icon">
            <ToothIcon />
          </span>
          <strong>Dental Agenda</strong>
        </div>
        <div className="agenda-topbar-actions">
          <button
            className={`icon-button ${notificationsReady ? "ready" : ""}`}
            type="button"
            aria-label="Notifications"
            onClick={() => {
              if (!notificationsReady) void ensureNotificationsEnabled();
              setShowNotifications((value) => !value);
              setShowProfileMenu(false);
            }}
          >
            {notificationsReady ? <Bell size={18} /> : <BellOff size={18} />}
          </button>
          {showNotifications && (
            <div className="notification-popover">
              <div>
                <strong>Notifications</strong>
                <span>{notificationsReady ? "Enabled" : "Off"}</span>
              </div>
              <p>
                {notificationsReady
                  ? "You'll get a push alert when either doctor's calendar changes."
                  : "Click the bell to enable lock-screen alerts on this device."}
              </p>
            </div>
          )}
          <div className="profile-menu-wrap">
            <button
              className={`icon-button profile-icon ${showProfileMenu ? "active" : ""}`}
              type="button"
              onClick={() => {
                setShowProfileMenu((value) => !value);
                setShowNotifications(false);
              }}
              aria-label="Open account menu"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" />
              ) : (
                <span>{(user.displayName ?? "D").slice(0, 1)}</span>
              )}
            </button>
            {showProfileMenu && (
              <div className="profile-menu">
                <strong>{user.displayName ?? "Clinic admin"}</strong>
                <small>{user.email ?? deviceName}</small>
                <button
                  type="button"
                  onClick={() => void onInstall().then(setStatusMessage)}
                >
                  Install app
                </button>
                <button type="button" onClick={onSignOut} disabled={authBusy}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="agenda-controls">
        <div className="segmented-group" role="group" aria-label="View mode">
          <button
            className={viewMode === "day" ? "active" : ""}
            type="button"
            onClick={() => setViewMode("day")}
            aria-label="Day view"
          >
            <Calendar size={16} />
          </button>
          <button
            className={viewMode === "week" ? "active" : ""}
            type="button"
            onClick={() => setViewMode("week")}
            aria-label="Week view"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
        <div
          className="segmented-group doctor-pills"
          role="group"
          aria-label="Filter by doctor"
        >
          <button
            className={doctorFilter === "both" ? "active" : ""}
            type="button"
            onClick={() => setDoctorFilter("both")}
          >
            Both
          </button>
          {DOCTORS.map((doctor) => (
            <button
              key={doctor.id}
              className={doctorFilter === doctor.id ? "active" : ""}
              type="button"
              onClick={() => setDoctorFilter(doctor.id)}
            >
              {doctor.shortName}
            </button>
          ))}
        </div>
      </div>

      <div className="agenda-datebar">
        <div className="date-nav">
          <button
            type="button"
            onClick={() => shiftDate(-1)}
            aria-label="Previous day"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="today-link"
            type="button"
            onClick={() => setSelectedDate(new Date())}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shiftDate(1)}
            aria-label="Next day"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="date-picker-wrap">
          <span className="agenda-date-label" aria-hidden="true">
            {friendlyDate(selectedDate)}
            <ChevronDown className="agenda-date-caret" size={12} />
          </span>
          <input
            className="hidden-date-input"
            type="date"
            value={activeDateKey}
            onChange={(event) => handleDateInputChange(event.target.value)}
            aria-label="Choose a date"
          />
        </span>
        <div className="patient-search-wrap">
          <label className="agenda-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search patients, phone"
            />
          </label>
          {searchFocused && searchResults.length > 0 && (
            <div
              className="search-results"
              onMouseDown={(event) => event.preventDefault()}
            >
              {searchResults.map(([id, patient]) => (
                <button
                  key={id}
                  type="button"
                  className="search-result-row"
                  onClick={() => openPatientFromSearch(id)}
                >
                  <span className="search-result-avatar">
                    {patient.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="search-result-info">
                    <strong>{patient.name}</strong>
                    <small>{patient.phone || "No phone on file"}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {statusMessage && <div className="agenda-status">{statusMessage}</div>}

      {viewMode === "week" ? (
        <div className="week-overview">
          {weekDates.map((date) => {
            const key = dateKey(date);
            const counts = weekCounts[key] ?? { berkay: 0, kagan: 0 };
            return (
              <button
                key={key}
                type="button"
                className={`week-day-card ${isSameDay(date, selectedDate) ? "active" : ""} ${
                  isSameDay(date, new Date()) ? "today" : ""
                }`}
                onClick={() => {
                  setSelectedDate(date);
                  setViewMode("day");
                }}
              >
                <span className="week-day-name">
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <strong className="week-day-num">{date.getDate()}</strong>
                <div className="week-day-counts">
                  <span className="tone-teal">{counts.berkay}</span>
                  <span className="tone-orange">{counts.kagan}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="agenda-board-wrap">
          <div
            className="agenda-board-header"
            style={{
              gridTemplateColumns: `var(--agenda-gutter, 64px) repeat(${visibleDoctors.length}, 1fr)`,
            }}
          >
            <div className="board-cell corner" />
            {visibleDoctors.map((doctor) => {
              const count = Object.keys(appointments[doctor.id] ?? {}).length;
              return (
                <header
                  className={`board-cell doctor-head tone-${doctor.tone}`}
                  key={doctor.id}
                >
                  <span className="doctor-avatar">{doctor.initial}</span>
                  <div>
                    <strong>{doctor.name}</strong>
                    <small>
                      {count} appointment{count === 1 ? "" : "s"}
                    </small>
                  </div>
                </header>
              );
            })}

            <div className="board-cell corner" />
            {visibleDoctors.map((doctor) => (
              <div className="board-cell doctor-note" key={doctor.id}>
                {noteDraftDoctor === doctor.id ? (
                  <textarea
                    autoFocus
                    value={noteDraftText}
                    onChange={(event) => setNoteDraftText(event.target.value)}
                    onBlur={() => void commitNote()}
                    rows={2}
                  />
                ) : (
                  <button
                    type="button"
                    className="add-note-link"
                    onClick={() => startEditNote(doctor.id)}
                  >
                    {notes[doctor.id]?.trim() ? (
                      notes[doctor.id]
                    ) : (
                      <>
                        <Plus size={12} /> Add daily note
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="agenda-board-scroll">
            <div
              className="agenda-board-body"
              style={{
                gridTemplateColumns: `var(--agenda-gutter, 64px) repeat(${visibleDoctors.length}, 1fr)`,
              }}
            >
              <div
                className="board-cell time-gutter"
                style={{ height: gridHeight }}
              >
                {HOURS.map((minutes) => (
                  <span
                    className="hour-label"
                    key={minutes}
                    style={{
                      top:
                        (minutes - DAY_START_MINUTES) * PX_PER_MINUTE +
                        BOARD_PADDING,
                    }}
                  >
                    {minutesToLabel(minutes)}
                  </span>
                ))}
              </div>
              {visibleDoctors.map((doctor) => (
                <div
                  className={`board-cell doctor-body tone-${doctor.tone}`}
                  key={doctor.id}
                  data-doctor-id={doctor.id}
                  style={{ height: gridHeight }}
                  onClick={(event) => handleColumnClick(event, doctor.id)}
                >
                  {HOURS.map((minutes) => (
                    <div
                      className="hour-line"
                      key={minutes}
                      style={{
                        top:
                          (minutes - DAY_START_MINUTES) * PX_PER_MINUTE +
                          BOARD_PADDING,
                      }}
                    />
                  ))}
                  {dragState?.isDragging &&
                    dragState.targetDoctorId === doctor.id && (
                      <div
                        className="drop-ghost"
                        style={{
                          top:
                            (dragState.snappedMinutes - DAY_START_MINUTES) *
                              PX_PER_MINUTE +
                            BOARD_PADDING,
                          height: Math.max(
                            dragState.duration * PX_PER_MINUTE,
                            34,
                          ),
                        }}
                      />
                    )}
                  {layoutAppointments(appointments[doctor.id] ?? {}).map(
                    ({ id, appointment, col, cols }) => (
                      <article
                        key={id}
                        className={`appt-card tone-${doctor.tone} ${
                          matchesSearch(appointment) ? "" : "dimmed"
                        } ${
                          dragState?.id === id &&
                          dragState.fromDoctorId === doctor.id &&
                          dragState.isDragging
                            ? "dragging"
                            : ""
                        }`}
                        style={{
                          top:
                            (labelToMinutes(appointment.start) -
                              DAY_START_MINUTES) *
                              PX_PER_MINUTE +
                            BOARD_PADDING,
                          height: Math.max(
                            appointment.duration * PX_PER_MINUTE,
                            34,
                          ),
                          left: `calc(6px + (100% - 12px - ${CARD_GAP * (cols - 1)}px) * ${col} / ${cols} + ${CARD_GAP * col}px)`,
                          width: `calc((100% - 12px - ${CARD_GAP * (cols - 1)}px) / ${cols})`,
                        }}
                        onPointerDown={(event) =>
                          handleDragStart(event, doctor.id, id, appointment)
                        }
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (justDraggedRef.current) {
                            justDraggedRef.current = false;
                            return;
                          }
                          openEditModal(doctor.id, id, appointment);
                        }}
                      >
                        <div className="appt-time">
                          {appointment.start} · {appointment.duration}m
                        </div>
                        <strong>{appointment.patientName}</strong>
                        {appointment.treatment && (
                          <span>{appointment.treatment}</span>
                        )}
                        {appointment.phone && (
                          <div
                            className="appt-actions"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <a
                              className="appt-action call"
                              href={`tel:${appointment.phone}`}
                              aria-label="Call patient"
                            >
                              <Phone size={11} />
                            </a>
                            <a
                              className="appt-action whatsapp"
                              href={whatsappHref(appointment.phone)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Message patient on WhatsApp"
                            >
                              <MessageCircle size={11} />
                            </a>
                          </div>
                        )}
                      </article>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalState && (
        <AppointmentModal
          doctors={DOCTORS}
          patients={patients}
          isEditing={modalState.mode === "edit"}
          draft={
            modalState.mode === "edit"
              ? {
                  doctorId: modalState.doctorId,
                  patientName: modalState.appointment.patientName,
                  phone: modalState.appointment.phone,
                  treatment: modalState.appointment.treatment,
                  date: modalState.date,
                  start: modalState.appointment.start,
                  duration: modalState.appointment.duration,
                  notes: modalState.appointment.notes,
                }
              : {
                  doctorId: modalState.doctorId,
                  patientName: modalState.patientName ?? "",
                  phone: modalState.phone ?? "",
                  treatment: "",
                  date: modalState.date,
                  start: modalState.start,
                  duration: 60,
                  notes: "",
                }
          }
          onCancel={() => setModalState(null)}
          onSave={(draft) => void handleModalSave(draft)}
          onDelete={
            modalState.mode === "edit"
              ? () => void handleModalDelete()
              : undefined
          }
        />
      )}

      {openPatientId && patients[openPatientId] && (
        <PatientProfile
          patientId={openPatientId}
          patient={patients[openPatientId]}
          onClose={() => setOpenPatientId(null)}
          onSchedule={scheduleForPatient}
        />
      )}
    </main>
  );
}
