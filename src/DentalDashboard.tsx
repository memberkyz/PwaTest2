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
  Users,
} from "lucide-react";
import { firebaseVapidKey, firebaseVapidKeyValid, messaging } from "./firebase";
import {
  DEFAULT_APPOINTMENT_COLOR,
  DOCTORS,
  createAppointment,
  createTreatmentRecord,
  dateKey,
  deleteAppointment,
  emptyDayAppointments,
  fetchDayAppointments,
  findOrCreatePatient,
  friendlyDate,
  getWeekDates,
  isSameDay,
  isoWeekLabel,
  labelToMinutes,
  laneMeta,
  minutesToLabel,
  moveAppointment,
  normalizeAppointmentColor,
  relocateAppointment,
  saveDailyNote,
  setAppointmentCheckedIn,
  shortDayLabel,
  subscribeToDay,
  subscribeToPatients,
  updatePatient,
  updateTreatmentRecord,
  visibleLanes,
  weekRangeLabel,
  type Appointment,
  type AppointmentMap,
  type DayAppointments,
  type DayNotes,
  type DoctorFilter,
  type DoctorId,
  type LaneId,
  type Patient,
  type PatientMap,
} from "./clinic";
import AppointmentModal, { type AppointmentDraft } from "./AppointmentModal";
import PatientProfilePanel from "./PatientProfile";
import logo from "./assets/logo-ui.png";

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
  /** Navigate to the dedicated Patients page. */
  onOpenPatients: () => void;
  /** Navigate to the Patients page with a specific patient selected. */
  onOpenPatient: (patientId: string) => void;
  /** A booking request that came from the Patients page. */
  pendingSchedule: {
    patientId: string;
    patient: Patient;
  } | null;
  onScheduleHandled: () => void;
}

type ViewMode = "day" | "week";

/** Summary numbers shown in the day footer. */
interface DaySummary {
  total: number;
  first: string | null;
  last: string | null;
  bookedMinutes: number;
  arrived: number;
}

const DAY_START_MINUTES = 7 * 60;
const DAY_END_MINUTES = 23 * 60;
const PX_PER_MINUTE = 1.4;
const BOARD_PADDING = 12;
const DRAG_THRESHOLD_PX = 6;
const CARD_GAP = 4;
const UNDO_WINDOW_MS = 8000;

/** Everything needed to put a cancelled appointment back exactly where it was. */
interface UndoState {
  kind: "cancel";
  laneId: LaneId;
  date: string;
  id: string;
  appointment: Appointment;
}
const HOURS = Array.from(
  { length: (DAY_END_MINUTES - DAY_START_MINUTES) / 60 + 1 },
  (_, index) => DAY_START_MINUTES + index * 60,
);

interface DragState {
  fromLane: LaneId;
  id: string;
  pointerId: number;
  grabOffsetY: number;
  duration: number;
  startX: number;
  startY: number;
  isDragging: boolean;
  targetLane: LaneId;
  snappedMinutes: number;
}

type ModalState =
  | {
      mode: "create";
      laneId: LaneId;
      date: string;
      start: string;
      patientId?: string;
      patientName?: string;
      phone?: string;
    }
  | {
      mode: "edit";
      laneId: LaneId;
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
  onOpenPatients,
  onOpenPatient,
  pendingSchedule,
  onScheduleHandled,
}: DentalDashboardProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [doctorFilter, setDoctorFilter] = useState<DoctorFilter>("both");
  const [query, setQuery] = useState("");
  const [appointments, setAppointments] = useState<DayAppointments>(() =>
    emptyDayAppointments(),
  );
  const [notes, setNotes] = useState<DayNotes>({ berkay: "", kagan: "" });
  // Full appointment data for the week view (counts alone are not enough to
  // render a real 7-column agenda).
  const [weekData, setWeekData] = useState<Record<string, DayAppointments>>({});
  const [weekLoading, setWeekLoading] = useState(false);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [noteDraftDoctor, setNoteDraftDoctor] = useState<DoctorId | null>(null);
  const [noteDraftText, setNoteDraftText] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  // Seed from the real permission so a returning user never sees a stale "off"
  // bell while the async token registration is still in flight.
  const [notificationsReady, setNotificationsReady] = useState(
    () =>
      typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  );
  const [notificationError, setNotificationError] = useState("");
  const [patients, setPatients] = useState<PatientMap>({});
  const [searchFocused, setSearchFocused] = useState(false);
  const [openPatientId, setOpenPatientId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  // Ticks every minute so the "now" line and in-progress styling stay honest.
  const [now, setNow] = useState(() => new Date());
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = isSameDay(selectedDate, now);

  function clearUndoTimer() {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }

  function showUndo(snapshot: UndoState) {
    clearUndoTimer();
    setUndoState(snapshot);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  }

  // Clear the pending undo if the component unmounts.
  useEffect(() => clearUndoTimer, []);

  const activeDateKey = useMemo(() => dateKey(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  // Lanes actually rendered on the board: honours the doctor filter and hides
  // the walk-in column when it is empty.
  const boardLanes = useMemo(
    () => visibleLanes(appointments, doctorFilter),
    [appointments, doctorFilter],
  );
  const laneCols = `var(--agenda-gutter, 64px) repeat(${boardLanes.length}, 1fr)`;

  useEffect(() => {
    setAppointments(emptyDayAppointments());
    return subscribeToDay(activeDateKey, setAppointments, setNotes);
  }, [activeDateKey]);

  useEffect(() => subscribeToPatients(setPatients), []);

  // A booking request from the Patients page: drop straight into the create
  // modal, pre-filled with that patient. Cleared immediately so re-renders
  // (or going back to Patients) never re-open the modal.
  useEffect(() => {
    if (!pendingSchedule) return;
    const defaultLane =
      boardLanes.find((lane) => lane !== "walkin") ?? DOCTORS[0].id;
    setModalState({
      mode: "create",
      laneId: defaultLane,
      date: activeDateKey,
      start: "09:00",
      patientId: pendingSchedule.patientId,
      patientName: pendingSchedule.patient.name,
      phone: pendingSchedule.patient.phone,
    });
    onScheduleHandled();
  }, [pendingSchedule, activeDateKey, boardLanes, onScheduleHandled]);

  // Keep the clock fresh so the "now" line does not go stale.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Open the day board scrolled to the current time instead of 07:00.
  useEffect(() => {
    if (viewMode !== "day" || !isToday) return;
    const scroller = boardScrollRef.current;
    if (!scroller) return;
    const offset = (nowMinutes - DAY_START_MINUTES) * PX_PER_MINUTE;
    // Only auto-scroll on first paint of a day, not on every minute tick.
    if (scroller.dataset.autoScrolled === activeDateKey) return;
    scroller.dataset.autoScrolled = activeDateKey;
    scroller.scrollTop = Math.max(0, offset - 160);
  }, [viewMode, isToday, activeDateKey, nowMinutes]);

  useEffect(() => {
    if (viewMode !== "week") return;
    let cancelled = false;
    setWeekLoading(true);
    (async () => {
      const entries = await Promise.all(
        weekDates.map(
          async (date) =>
            [dateKey(date), await fetchDayAppointments(dateKey(date))] as const,
        ),
      );
      if (!cancelled) {
        setWeekData(Object.fromEntries(entries));
        setWeekLoading(false);
      }
    })().catch(() => {
      if (!cancelled) setWeekLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [viewMode, weekDates]);

  /** Numbers for the day footer: volume, window, booked time, arrivals. */
  const daySummary = useMemo<DaySummary>(() => {
    let total = 0;
    let first: number | null = null;
    let last = 0;
    let bookedMinutes = 0;
    let arrived = 0;
    for (const lane of boardLanes) {
      for (const appointment of Object.values(appointments[lane] ?? {})) {
        total += 1;
        const start = labelToMinutes(appointment.start);
        const end = start + appointment.duration;
        bookedMinutes += appointment.duration;
        if (first === null || start < first) first = start;
        if (end > last) last = end;
        if (appointment.arrived) arrived += 1;
      }
    }
    return {
      total,
      first: first === null ? null : minutesToLabel(first),
      last: last === 0 ? null : minutesToLabel(last),
      bookedMinutes,
      arrived,
    };
  }, [appointments, boardLanes]);

  /** Week-wide totals for the week view header. */
  const weekTotals = useMemo(() => {
    let count = 0;
    let arrived = 0;
    for (const key of Object.keys(weekData)) {
      for (const lane of boardLanes) {
        for (const appointment of Object.values(weekData[key][lane] ?? {})) {
          count += 1;
          if (appointment.arrived) arrived += 1;
        }
      }
    }
    return { count, arrived };
  }, [weekData, boardLanes]);

  function scrollToNow() {
    const scroller = boardScrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = Math.max(
      0,
      (nowMinutes - DAY_START_MINUTES) * PX_PER_MINUTE - 160,
    );
  }

  async function ensureNotificationsEnabled() {
    setNotificationError("");
    if (!messaging || !firebaseVapidKey || !firebaseVapidKeyValid) {
      setNotificationError("Firebase push is not configured for this deploy.");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotificationError("This browser cannot show notifications.");
      return;
    }
    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        setNotificationsReady(false);
        setNotificationError(
          permission === "denied"
            ? "Notifications are blocked in your browser settings."
            : "Notification permission was not granted.",
        );
        return;
      }
      const registration = await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js",
      );
      await registration.update();
      await navigator.serviceWorker.ready;
      const token = await getToken(messaging, {
        vapidKey: firebaseVapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token) {
        setNotificationsReady(false);
        setNotificationError(
          "Could not get a messaging token. Check the VAPID key and try again.",
        );
        return;
      }
      const response = await fetch("/api/register-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, deviceName }),
      });
      if (!response.ok) {
        // Permission is granted but this device is not actually registered.
        setNotificationsReady(false);
        setNotificationError(
          "Alerts are allowed, but this device is not registered yet. Try again in a moment.",
        );
        return;
      }
      setNotificationsReady(true);
    } catch {
      setNotificationsReady(false);
      setNotificationError(
        "Could not finish enabling alerts. Check your connection and try again.",
      );
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
        await registration.showNotification(data.title ?? "Memo Dental", {
          body: data.body ?? "An appointment changed.",
          icon: "/icon-192.png",
          badge: "/favicon-32.png",
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

  function doctorName(id: LaneId): string {
    return laneMeta(id).name;
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
    // Default onto a real doctor column, never the walk-in lane.
    const defaultLane =
      boardLanes.find((lane) => lane !== "walkin") ?? DOCTORS[0].id;
    setModalState({
      mode: "create",
      laneId: defaultLane,
      date: activeDateKey,
      start: "09:00",
      patientId,
      patientName: patient.name,
      phone: patient.phone,
    });
  }

  function openCreateModal(laneId: LaneId, start: string) {
    setModalState({ mode: "create", laneId, date: activeDateKey, start });
  }

  function openEditModal(laneId: LaneId, id: string, appointment: Appointment) {
    setModalState({
      mode: "edit",
      laneId,
      date: activeDateKey,
      id,
      appointment,
    });
  }

  function handleColumnClick(
    event: React.MouseEvent<HTMLDivElement>,
    laneId: LaneId,
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
    openCreateModal(laneId, minutesToLabel(snapped));
  }

  function handleDragStart(
    event: React.PointerEvent<HTMLElement>,
    laneId: LaneId,
    id: string,
    appointment: Appointment,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const card = event.currentTarget;
    card.setPointerCapture(event.pointerId);
    const cardRect = card.getBoundingClientRect();
    setDragState({
      fromLane: laneId,
      id,
      pointerId: event.pointerId,
      grabOffsetY: event.clientY - cardRect.top,
      duration: appointment.duration,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
      targetLane: laneId,
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
            element.closest(".lane-body") !== null,
        )
        ?.closest<HTMLElement>(".lane-body");
      if (!column?.dataset.laneId) return { ...previous, isDragging };

      const targetLane = column.dataset.laneId as LaneId;
      const rect = column.getBoundingClientRect();
      const rawMinutes =
        DAY_START_MINUTES +
        (event.clientY - rect.top - previous.grabOffsetY - BOARD_PADDING) /
          PX_PER_MINUTE;
      const snappedMinutes = Math.min(
        Math.max(Math.round(rawMinutes / 15) * 15, DAY_START_MINUTES),
        DAY_END_MINUTES - 15,
      );
      return { ...previous, isDragging, targetLane, snappedMinutes };
    });
  }

  function handleDragEnd(event: React.PointerEvent<HTMLElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = dragState;
    setDragState(null);
    if (!drag.isDragging) return;
    justDraggedRef.current = true;

    const appointment = appointments[drag.fromLane]?.[drag.id];
    if (!appointment) return;
    const newStart = minutesToLabel(drag.snappedMinutes);
    if (drag.targetLane === drag.fromLane && newStart === appointment.start) {
      return;
    }
    const updated: Appointment = {
      ...appointment,
      start: newStart,
      updatedAt: Date.now(),
    };
    // Attributing a walk-in to a doctor is a real scheduling decision, so make
    // the user confirm rather than silently booking them in.
    if (drag.fromLane === "walkin" && drag.targetLane !== "walkin") {
      const proceed = window.confirm(
        `Assign ${appointment.patientName} to ${doctorName(drag.targetLane)}?`,
      );
      if (!proceed) return;
    }
    moveAppointment(
      activeDateKey,
      drag.fromLane,
      drag.targetLane,
      drag.id,
      updated,
    )
      .then(() => {
        if (updated.patientId) {
          void updateTreatmentRecord(updated.patientId, drag.id, {
            doctorId: drag.targetLane,
          });
        }
        notifyChange(
          `${appointment.patientName} rescheduled to ${newStart} with ${doctorName(drag.targetLane)}`,
        );
      })
      .catch(() => setStatusMessage("Could not reschedule the appointment"));
  }

  /** Toggle the waiting-room check-in chip. */
  async function handleToggleArrived(laneId: LaneId, id: string) {
    const appointment = appointments[laneId]?.[id];
    if (!appointment) return;
    const next = !appointment.arrived;
    try {
      await setAppointmentCheckedIn(activeDateKey, laneId, id, next);
      notifyChange(
        next
          ? `${appointment.patientName} arrived and is waiting`
          : `${appointment.patientName} is no longer waiting`,
      );
    } catch {
      setStatusMessage("Could not update the arrival status");
    }
  }

  async function handleModalSave(draft: AppointmentDraft) {
    const appointment: Appointment = {
      patientName: draft.patientName.trim(),
      phone: draft.phone.trim(),
      treatment: draft.treatment.trim(),
      color: draft.color,
      start: draft.start,
      duration: draft.duration,
      notes: draft.notes.trim(),
      updatedAt: Date.now(),
    };
    const startMinutes = labelToMinutes(appointment.start);
    const endMinutes = startMinutes + appointment.duration;

    // Conflict check: warn (don't block) if this doctor already has an
    // appointment covering the same slot. Double-booking is sometimes
    // intentional at a clinic, so we confirm instead of refusing.
    let dayView: DayAppointments = appointments;
    if (draft.date !== activeDateKey) {
      try {
        dayView = await fetchDayAppointments(draft.date);
      } catch {
        dayView = appointments;
      }
    }
    const editId = modalState?.mode === "edit" ? modalState.id : undefined;
    // Walk-ins share one lane, so a "clash" there is expected, not a problem.
    const clash =
      draft.laneId === "walkin"
        ? undefined
        : Object.entries(dayView[draft.laneId] ?? {}).find(([id, other]) => {
            if (id === editId) return false;
            const otherStart = labelToMinutes(other.start);
            const otherEnd = otherStart + other.duration;
            return startMinutes < otherEnd && endMinutes > otherStart;
          });
    if (clash) {
      const [, other] = clash;
      const otherEnd = minutesToLabel(
        labelToMinutes(other.start) + other.duration,
      );
      const proceed = window.confirm(
        `${doctorName(draft.laneId)} already has ${other.patientName} at ${other.start} (until ${otherEnd}).\n\nSave anyway?`,
      );
      if (!proceed) return;
    }

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
          modalState.laneId,
          draft.laneId,
          modalState.id,
          appointment,
        );
        await updateTreatmentRecord(patientId, modalState.id, {
          date: draft.date,
          doctorId: draft.laneId,
          treatment: appointment.treatment,
          notes: appointment.notes,
        });
        notifyChange(
          `${appointment.patientName}'s appointment was updated (${doctorName(draft.laneId)})`,
        );
      } else {
        const appointmentId = await createAppointment(
          draft.date,
          draft.laneId,
          appointment,
        );
        await createTreatmentRecord(patientId, appointmentId, {
          date: draft.date,
          doctorId: draft.laneId,
          treatment: appointment.treatment,
          notes: appointment.notes,
          appointmentId,
          createdAt: Date.now(),
        });
        notifyChange(
          `New appointment: ${appointment.patientName} with ${doctorName(draft.laneId)} at ${appointment.start}`,
        );
      }
      setModalState(null);
    } catch {
      setStatusMessage("Could not save the appointment");
    }
  }

  async function handleModalDelete() {
    if (modalState?.mode !== "edit") return;
    const { laneId, date, id, appointment } = modalState;
    try {
      if (appointment.patientId) {
        await updateTreatmentRecord(appointment.patientId, id, {
          cancelled: true,
        });
      }
      await deleteAppointment(date, laneId, id);
      notifyChange(
        `${appointment.patientName}'s appointment with ${doctorName(laneId)} was cancelled`,
      );
      setModalState(null);
      // Keep a snapshot so a mis-tap can be reversed instead of losing the slot.
      showUndo({ kind: "cancel", laneId, date, id, appointment });
      setStatusMessage(
        `Cancelled ${appointment.patientName} at ${appointment.start}.`,
      );
    } catch {
      setStatusMessage("Could not cancel the appointment");
    }
  }

  async function handleUndo() {
    const snapshot = undoState;
    if (!snapshot) return;
    clearUndoTimer();
    setUndoState(null);
    try {
      // Restore the appointment slot under its original id so the linked
      // treatment record (same id) starts mirroring again.
      await moveAppointment(
        snapshot.date,
        snapshot.laneId,
        snapshot.laneId,
        snapshot.id,
        snapshot.appointment,
      );
      if (snapshot.appointment.patientId) {
        await updateTreatmentRecord(
          snapshot.appointment.patientId,
          snapshot.id,
          { cancelled: false },
        );
      }
      // Only restore if the user is still looking at that day, otherwise the
      // board would look broken until they navigate back.
      if (activeDateKey !== snapshot.date) {
        // Parse as a local date; `new Date("yyyy-mm-dd")` is UTC and can
        // shift the day in negative-offset timezones.
        const [year, month, day] = snapshot.date.split("-").map(Number);
        setSelectedDate(new Date(year, month - 1, day));
      }
      notifyChange(
        `${snapshot.appointment.patientName}'s appointment was restored`,
      );
      setStatusMessage(
        `Restored ${snapshot.appointment.patientName} at ${snapshot.appointment.start}.`,
      );
    } catch {
      setStatusMessage("Could not restore the appointment");
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
      <header className="agenda-header">
        <div className="agenda-topbar">
          <div className="agenda-brand">
            <img className="agenda-brand-icon" src={logo} alt="" />
            <strong>Memo Dental</strong>
            {isToday && <span className="brand-live">Live</span>}
          </div>
          <div className="agenda-topbar-actions">
            <button
              className="nav-patients-button"
              type="button"
              onClick={onOpenPatients}
              title="Open the patients page"
            >
              <Users size={16} />
              <span>Patients</span>
            </button>
            <button
              className={`icon-button ${notificationsReady ? "ready" : ""}`}
              type="button"
              aria-label="Notifications"
              aria-pressed={notificationsReady}
              title={
                notificationsReady ? "Notifications on" : "Notifications off"
              }
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
                  {notificationError
                    ? notificationError
                    : notificationsReady
                      ? "You'll get a push alert when either doctor's calendar changes."
                      : "Click the bell to enable lock-screen alerts on this device."}
                </p>
                {!notificationsReady && !notificationError && (
                  <button
                    className="notification-enable-button"
                    type="button"
                    onClick={() => void ensureNotificationsEnabled()}
                  >
                    Enable notifications
                  </button>
                )}
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
        </div>

        <div className="agenda-controls">
          <div
            className="segmented-group view-toggle"
            role="group"
            aria-label="View mode"
          >
            <button
              className={viewMode === "day" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("day")}
              aria-label="Day view"
            >
              <Calendar size={15} />
              <span>Day</span>
            </button>
            <button
              className={viewMode === "week" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("week")}
              aria-label="Week view"
            >
              <LayoutGrid size={15} />
              <span>Week</span>
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
              All
            </button>
            {DOCTORS.map((doctor) => (
              <button
                key={doctor.id}
                className={doctorFilter === doctor.id ? "active" : ""}
                type="button"
                onClick={() => setDoctorFilter(doctor.id)}
              >
                <span className={`dot dot-${doctor.tone}`} />
                {doctor.shortName}
              </button>
            ))}
            {(Object.keys(appointments.walkin ?? {}).length > 0 ||
              doctorFilter === "walkin") && (
              <button
                className={doctorFilter === "walkin" ? "active" : ""}
                type="button"
                onClick={() =>
                  setDoctorFilter(doctorFilter === "walkin" ? "both" : "walkin")
                }
              >
                Walk-ins
              </button>
            )}
          </div>
        </div>

        <div className="agenda-datebar">
          <div className="date-row">
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
            {viewMode === "day" && (
              <div className="day-stats">
                <span className="summary-item">
                  <strong>{daySummary.total}</strong> appt
                  {daySummary.total === 1 ? "" : "s"}
                </span>
                {daySummary.first && (
                  <span className="summary-item">
                    <strong>{daySummary.first}</strong>–
                    <strong>{daySummary.last}</strong>
                  </span>
                )}
                {daySummary.arrived > 0 && (
                  <span className="summary-item waiting">
                    <strong>{daySummary.arrived}</strong> waiting
                  </span>
                )}
                {isToday && (
                  <button
                    type="button"
                    className="summary-now-button"
                    onClick={scrollToNow}
                    title="Scroll the board to the current time"
                  >
                    Now
                  </button>
                )}
              </div>
            )}
          </div>
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
      </header>

      {statusMessage && <div className="agenda-status">{statusMessage}</div>}

      {undoState && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>Cancelled {undoState.appointment.patientName}</span>
          <button type="button" onClick={() => void handleUndo()}>
            Undo
          </button>
        </div>
      )}

      {viewMode === "week" ? (
        <div className="week-grid-wrap">
          <div className="week-head">
            <div className="week-head-title">
              <span className="week-number">{isoWeekLabel(selectedDate)}</span>
              <span className="week-range">{weekRangeLabel(weekDates)}</span>
            </div>
            <div className="week-head-meta">
              <span className="week-total">
                <strong>{weekTotals.count}</strong> appt
                {weekTotals.count === 1 ? "" : "s"}
              </span>
              {weekTotals.arrived > 0 && (
                <span className="week-total waiting">
                  <strong>{weekTotals.arrived}</strong> waiting
                </span>
              )}
              <span className="week-nav">
                <button
                  type="button"
                  onClick={() => shiftDate(-7)}
                  aria-label="Previous week"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(new Date())}
                  className="week-today-link"
                >
                  This week
                </button>
                <button
                  type="button"
                  onClick={() => shiftDate(7)}
                  aria-label="Next week"
                >
                  <ChevronRight size={15} />
                </button>
              </span>
            </div>
          </div>
          {weekLoading && <div className="week-loading">Loading week…</div>}
          <div className="week-grid">
            {weekDates.map((date) => {
              const key = dateKey(date);
              const dayData = weekData[key] ?? {};
              const today = isSameDay(date, now);
              const selected = isSameDay(date, selectedDate);
              const dayCount = boardLanes.reduce(
                (sum, lane) => sum + Object.keys(dayData[lane] ?? {}).length,
                0,
              );
              return (
                <section
                  key={key}
                  className={`week-col ${selected ? "selected" : ""} ${today ? "today" : ""}`}
                >
                  <button
                    type="button"
                    className="week-col-head"
                    onClick={() => {
                      setSelectedDate(date);
                      setViewMode("day");
                    }}
                    aria-label={`${friendlyDate(date)}, ${dayCount} appointments`}
                  >
                    <span className="week-day-name">{shortDayLabel(date)}</span>
                    <strong className="week-day-num">{date.getDate()}</strong>
                    <span
                      className={`week-day-badge ${dayCount > 0 ? "has" : ""}`}
                    >
                      {dayCount > 0 ? dayCount : "·"}
                    </span>
                  </button>
                  <div className="week-col-body">
                    {(() => {
                      const chips = boardLanes
                        .flatMap((lane) =>
                          Object.entries(dayData[lane] ?? {}).map(
                            ([id, appointment]) => ({
                              key: `${lane}-${id}`,
                              lane,
                              appointment,
                            }),
                          ),
                        )
                        .sort(
                          (a, b) =>
                            a.appointment.start.localeCompare(
                              b.appointment.start,
                            ) ||
                            laneMeta(a.lane).name.localeCompare(
                              laneMeta(b.lane).name,
                            ),
                        );
                      if (chips.length === 0) {
                        return <p className="week-col-empty">Free</p>;
                      }
                      return chips.map(({ key, lane, appointment }) => (
                        <button
                          key={key}
                          type="button"
                          className={`week-chip tone-${laneMeta(lane).tone} ${
                            appointment.arrived ? "arrived" : ""
                          }`}
                          onClick={() => {
                            setSelectedDate(date);
                            setViewMode("day");
                            if (appointment.patientId) {
                              setOpenPatientId(appointment.patientId);
                            }
                          }}
                        >
                          <span className="week-chip-time">
                            {appointment.start}
                          </span>
                          <strong>
                            {appointment.patientName || "Unnamed"}
                          </strong>
                          <small>
                            {laneMeta(lane).isDoctor
                              ? laneMeta(lane).shortName
                              : "Walk-in"}
                            {appointment.treatment
                              ? ` · ${appointment.treatment}`
                              : ""}
                          </small>
                        </button>
                      ));
                    })()}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="agenda-board-wrap">
          <div
            className="agenda-board-header"
            style={{ gridTemplateColumns: laneCols }}
          >
            <div className="board-cell corner" />
            {boardLanes.map((laneId) => {
              const lane = laneMeta(laneId);
              const count = Object.keys(appointments[laneId] ?? {}).length;
              return (
                <header
                  className={`board-cell doctor-head tone-${lane.tone}`}
                  key={laneId}
                >
                  <span className="doctor-avatar">{lane.initial}</span>
                  <div>
                    <strong>{lane.name}</strong>
                    <small>
                      {count} appointment{count === 1 ? "" : "s"}
                    </small>
                  </div>
                </header>
              );
            })}

            <div className="board-cell corner" />
            {boardLanes
              .filter((laneId) => laneMeta(laneId).isDoctor)
              .map((laneId) => {
                const doctorId = laneId as DoctorId;
                return (
                  <div className="board-cell doctor-note" key={laneId}>
                    {noteDraftDoctor === doctorId ? (
                      <textarea
                        autoFocus
                        value={noteDraftText}
                        onChange={(event) =>
                          setNoteDraftText(event.target.value)
                        }
                        onBlur={() => void commitNote()}
                        rows={2}
                      />
                    ) : (
                      <button
                        type="button"
                        className="add-note-link"
                        onClick={() => startEditNote(doctorId)}
                      >
                        {notes[doctorId]?.trim() ? (
                          notes[doctorId]
                        ) : (
                          <>
                            <Plus size={12} /> Add daily note
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>

          <div className="agenda-board-scroll" ref={boardScrollRef}>
            <div
              className="agenda-board-body"
              style={{ gridTemplateColumns: laneCols }}
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
              {boardLanes.map((laneId) => {
                const lane = laneMeta(laneId);
                return (
                  <div
                    className={`board-cell lane-body tone-${lane.tone}`}
                    key={laneId}
                    data-lane-id={laneId}
                    style={{ height: gridHeight }}
                    onClick={(event) => handleColumnClick(event, laneId)}
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
                    {isToday &&
                      nowMinutes >= DAY_START_MINUTES &&
                      nowMinutes <= DAY_END_MINUTES && (
                        <div
                          className="now-line"
                          style={{
                            top:
                              (nowMinutes - DAY_START_MINUTES) * PX_PER_MINUTE +
                              BOARD_PADDING,
                          }}
                        />
                      )}
                    {dragState?.isDragging &&
                      dragState.targetLane === laneId && (
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
                    {layoutAppointments(appointments[laneId] ?? {}).map(
                      ({ id, appointment, col, cols }) => {
                        const startMin = labelToMinutes(appointment.start);
                        const inProgress =
                          isToday &&
                          nowMinutes >= startMin &&
                          nowMinutes < startMin + appointment.duration;
                        return (
                          <article
                            key={id}
                            className={`appt-card tone-${lane.tone} color-${normalizeAppointmentColor(
                              appointment.color,
                            )} ${matchesSearch(appointment) ? "" : "dimmed"} ${
                              dragState?.id === id &&
                              dragState.fromLane === laneId &&
                              dragState.isDragging
                                ? "dragging"
                                : ""
                            } ${inProgress ? "in-progress" : ""} ${
                              appointment.arrived ? "arrived" : ""
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
                              handleDragStart(event, laneId, id, appointment)
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
                              openEditModal(laneId, id, appointment);
                            }}
                          >
                            <div className="appt-time">
                              {appointment.start} · {appointment.duration}m
                            </div>
                            <strong>{appointment.patientName}</strong>
                            {appointment.treatment && (
                              <span>{appointment.treatment}</span>
                            )}
                            <button
                              type="button"
                              className={`arrive-chip ${appointment.arrived ? "on" : ""}`}
                              aria-pressed={Boolean(appointment.arrived)}
                              title={
                                appointment.arrived
                                  ? `${appointment.patientName} is waiting — tap to undo`
                                  : `Mark ${appointment.patientName} as arrived`
                              }
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleArrived(laneId, id);
                              }}
                            >
                              {appointment.arrived ? "Arrived" : "Arrive"}
                            </button>
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
                        );
                      },
                    )}
                  </div>
                );
              })}
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
                  laneId: modalState.laneId,
                  patientName: modalState.appointment.patientName,
                  phone: modalState.appointment.phone,
                  treatment: modalState.appointment.treatment,
                  color: normalizeAppointmentColor(
                    modalState.appointment.color,
                  ),
                  date: modalState.date,
                  start: modalState.appointment.start,
                  duration: modalState.appointment.duration,
                  notes: modalState.appointment.notes,
                }
              : {
                  laneId: modalState.laneId,
                  patientName: modalState.patientName ?? "",
                  phone: modalState.phone ?? "",
                  treatment: "",
                  color: DEFAULT_APPOINTMENT_COLOR,
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
        <div className="modal-backdrop" onClick={() => setOpenPatientId(null)}>
          <div
            className="modal-card patient-profile"
            onClick={(event) => event.stopPropagation()}
          >
            <PatientProfilePanel
              patientId={openPatientId}
              patient={patients[openPatientId]}
              onClose={() => setOpenPatientId(null)}
              onSchedule={scheduleForPatient}
              onDeleted={() => setOpenPatientId(null)}
            />
            <div className="patient-profile-footer">
              <button
                type="button"
                className="modal-cancel"
                onClick={() => {
                  const patientId = openPatientId;
                  setOpenPatientId(null);
                  onOpenPatient(patientId);
                }}
              >
                Open full profile page
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
