import {
  get,
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "firebase/database";
import { database } from "./firebase";

export type DoctorId = "berkay" | "kagan";

/**
 * Columns on the day board. `walkin` is a real lane (not a doctor) for
 * unassigned patients; it is hidden whenever it holds nothing.
 */
export type LaneId = DoctorId | "walkin";

export const LANE_IDS: LaneId[] = ["berkay", "kagan", "walkin"];

export interface Doctor {
  id: DoctorId;
  name: string;
  shortName: string;
  initial: string;
  tone: "teal" | "orange";
}

export const DOCTORS: Doctor[] = [
  {
    id: "berkay",
    name: "Dr. Berkay",
    shortName: "Berkay",
    initial: "B",
    tone: "teal",
  },
  {
    id: "kagan",
    name: "Dr. Kagan",
    shortName: "Kagan",
    initial: "K",
    tone: "orange",
  },
];

/**
 * Predefined appointment colors. The front desk picks one of these when
 * booking so the board reads at a glance (e.g. color by treatment type).
 */
export const APPOINTMENT_COLORS = [
  { id: "teal", label: "Teal", hex: "#17a398" },
  { id: "orange", label: "Orange", hex: "#d97b28" },
  { id: "blue", label: "Blue", hex: "#2f6fed" },
  { id: "purple", label: "Purple", hex: "#7c5cd6" },
  { id: "green", label: "Green", hex: "#3f9d4e" },
  { id: "rose", label: "Rose", hex: "#d94f6f" },
  { id: "amber", label: "Amber", hex: "#d9a520" },
  { id: "slate", label: "Slate", hex: "#7d8c86" },
] as const;

export type AppointmentColor = (typeof APPOINTMENT_COLORS)[number]["id"];

export const DEFAULT_APPOINTMENT_COLOR: AppointmentColor = "teal";

/** Unknown/legacy values fall back to the default so old data still renders. */
export function normalizeAppointmentColor(value: unknown): AppointmentColor {
  const match = APPOINTMENT_COLORS.find((entry) => entry.id === value);
  return match ? match.id : DEFAULT_APPOINTMENT_COLOR;
}

export interface Appointment {
  patientName: string;
  phone: string;
  treatment: string;
  /** Predefined board color; optional for appointments created earlier. */
  color?: AppointmentColor;
  start: string; // "HH:mm", 15-minute granularity
  duration: number; // minutes
  notes: string;
  updatedAt: number;
  patientId?: string;
  /** Set when the patient arrives in the waiting room. */
  checkedInAt?: number;
  /** `false` clears the check-in; `true` marks arrival. */
  arrived?: boolean;
}

/** Lane metadata for the day board, including the synthetic walk-in column. */
export interface Lane {
  id: LaneId;
  name: string;
  shortName: string;
  initial: string;
  tone: "teal" | "orange" | "slate";
  isDoctor: boolean;
}

export interface Patient {
  name: string;
  phone: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface TreatmentRecord {
  date: string; // "yyyy-mm-dd"
  /** `walkin` means the visit was not attributed to a specific doctor. */
  doctorId: LaneId;
  treatment: string;
  cancelled?: boolean;
  notes: string;
  createdAt: number;
  appointmentId?: string;
}

export type AppointmentMap = Record<string, Appointment>;
/** Day board columns. `walkin` is optional; missing means "no unassigned". */
export type DayAppointments = Partial<Record<LaneId, AppointmentMap>>;
export type DayNotes = Record<DoctorId, string>;
export type DayCounts = Partial<Record<LaneId, number>>;
export type PatientMap = Record<string, Patient>;
export type RecordMap = Record<string, TreatmentRecord>;

export function emptyDayAppointments(): DayAppointments {
  return { berkay: {}, kagan: {}, walkin: {} };
}

/** Walk-ins are front-desk reality, but an empty lane is just noise. */
export function visibleLanes(
  day: DayAppointments,
  filter: DoctorFilter,
): LaneId[] {
  const hasWalkins = Object.keys(day.walkin ?? {}).length > 0;
  const base: LaneId[] =
    filter === "both" ? LANE_IDS : filter === "walkin" ? ["walkin"] : [filter];
  return base.filter(
    (lane) => lane !== "walkin" || hasWalkins || filter === "walkin",
  );
}

export type DoctorFilter = "both" | LaneId;

/** Lane descriptor for the board header/body. */
export function laneMeta(lane: LaneId): Lane {
  if (lane === "walkin") {
    return {
      id: "walkin",
      name: "Unassigned",
      shortName: "Walk-ins",
      initial: "?",
      tone: "slate",
      isDoctor: false,
    };
  }
  const doctor = DOCTORS.find((entry) => entry.id === lane);
  return {
    id: doctor?.id ?? lane,
    name: doctor?.name ?? lane,
    shortName: doctor?.shortName ?? lane,
    initial: doctor?.initial ?? "?",
    tone: doctor?.tone ?? "teal",
    isDoctor: true,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function friendlyDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

export function getWeekDates(date: Date): Date[] {
  const mondayOffset = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day;
  });
}

/**
 * ISO-8601 week number (weeks start Monday, week 1 contains the first
 * Thursday of the year). This is the same numbering used by ISO calendars,
 * so "Week 40" here matches what a printed planner would say.
 */
export function getIsoWeekNumber(date: Date): number {
  // Work in UTC so DST transitions can't shift the day-of-week.
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  // Thursday of the current week determines the ISO year/week.
  const dayOfWeek = (target.getUTCDay() + 6) % 7; // Mon = 0
  target.setUTCDate(target.getUTCDate() - dayOfWeek + 3);
  const isoThursday = new Date(target);
  const firstThursday = new Date(Date.UTC(isoThursday.getUTCFullYear(), 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
  return (
    1 +
    Math.round((isoThursday.getTime() - firstThursday.getTime()) / 604800000)
  );
}

/** ISO year the given date belongs to (can differ from the calendar year). */
export function getIsoWeekYear(date: Date): number {
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayOfWeek = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayOfWeek + 3);
  return target.getUTCFullYear();
}

/** "Week 40" — short label used in the week view header. */
export function isoWeekLabel(date: Date): string {
  return `Week ${getIsoWeekNumber(date)}`;
}

/** "29 Sep – 3 Oct" — the Mon–Sun date span of the week containing `date`. */
export function weekRangeLabel(dates: Date[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return "";
  const firstLabel = first.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  const lastLabel = last.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return `${firstLabel} – ${lastLabel}`;
}

/** "Mon 29" / "Tue 30" — the per-column header. */
export function shortDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

export function minutesToLabel(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function labelToMinutes(label: string): number {
  const [hours, minutes] = label.split(":").map(Number);
  return hours * 60 + minutes;
}

function dayPath(key: string): string {
  return `clinicAgenda/${key}`;
}

const EMPTY_APPOINTMENTS: DayAppointments = {
  berkay: {},
  kagan: {},
  walkin: {},
};
const EMPTY_NOTES: DayNotes = { berkay: "", kagan: "" };

export function subscribeToDay(
  key: string,
  onAppointments: (data: DayAppointments) => void,
  onNotes: (data: DayNotes) => void,
): () => void {
  if (!database) {
    onAppointments(EMPTY_APPOINTMENTS);
    onNotes(EMPTY_NOTES);
    return () => {};
  }
  const unsubscribeAppointments = onValue(
    ref(database, `${dayPath(key)}/appointments`),
    (snapshot) => {
      const value = (snapshot.val() ?? {}) as Partial<DayAppointments>;
      onAppointments({
        berkay: value.berkay ?? {},
        kagan: value.kagan ?? {},
        walkin: value.walkin ?? {},
      });
    },
  );
  const unsubscribeNotes = onValue(
    ref(database, `${dayPath(key)}/notes`),
    (snapshot) => {
      const value = (snapshot.val() ?? {}) as Partial<DayNotes>;
      onNotes({ berkay: value.berkay ?? "", kagan: value.kagan ?? "" });
    },
  );
  return () => {
    unsubscribeAppointments();
    unsubscribeNotes();
  };
}

export async function fetchDayCounts(key: string): Promise<DayCounts> {
  if (!database) return { berkay: 0, kagan: 0, walkin: 0 };
  const snapshot = await get(ref(database, `${dayPath(key)}/appointments`));
  const value = (snapshot.val() ?? {}) as Partial<DayAppointments>;
  return {
    berkay: Object.keys(value.berkay ?? {}).length,
    kagan: Object.keys(value.kagan ?? {}).length,
    walkin: Object.keys(value.walkin ?? {}).length,
  };
}

/** One-shot read of a day's appointments, for conflict checks on other days. */
export async function fetchDayAppointments(
  key: string,
): Promise<DayAppointments> {
  if (!database) return { berkay: {}, kagan: {}, walkin: {} };
  const snapshot = await get(ref(database, `${dayPath(key)}/appointments`));
  const value = (snapshot.val() ?? {}) as Partial<DayAppointments>;
  return {
    berkay: value.berkay ?? {},
    kagan: value.kagan ?? {},
    walkin: value.walkin ?? {},
  };
}

export async function createAppointment(
  key: string,
  laneId: LaneId,
  appointment: Appointment,
): Promise<string> {
  if (!database) throw new Error("Firebase is not configured");
  const newRef = push(ref(database, `${dayPath(key)}/appointments/${laneId}`));
  await set(newRef, appointment);
  return newRef.key as string;
}

export async function updateAppointment(
  key: string,
  laneId: LaneId,
  id: string,
  appointment: Appointment,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await set(
    ref(database, `${dayPath(key)}/appointments/${laneId}/${id}`),
    appointment,
  );
}

export async function moveAppointment(
  key: string,
  fromLane: LaneId,
  toLane: LaneId,
  id: string,
  appointment: Appointment,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  if (fromLane === toLane) {
    await set(
      ref(database, `${dayPath(key)}/appointments/${toLane}/${id}`),
      appointment,
    );
    return;
  }
  await update(ref(database), {
    [`${dayPath(key)}/appointments/${fromLane}/${id}`]: null,
    [`${dayPath(key)}/appointments/${toLane}/${id}`]: appointment,
  });
}

/** Like moveAppointment, but can also relocate the appointment to a different day. */
export async function relocateAppointment(
  fromKey: string,
  toKey: string,
  fromLane: LaneId,
  toLane: LaneId,
  id: string,
  appointment: Appointment,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  if (fromKey === toKey && fromLane === toLane) {
    await set(
      ref(database, `${dayPath(toKey)}/appointments/${toLane}/${id}`),
      appointment,
    );
    return;
  }
  await update(ref(database), {
    [`${dayPath(fromKey)}/appointments/${fromLane}/${id}`]: null,
    [`${dayPath(toKey)}/appointments/${toLane}/${id}`]: appointment,
  });
}

export async function deleteAppointment(
  key: string,
  laneId: LaneId,
  id: string,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await remove(ref(database, `${dayPath(key)}/appointments/${laneId}/${id}`));
}

/** Mark a patient as arrived / no longer waiting. */
export async function setAppointmentCheckedIn(
  key: string,
  laneId: LaneId,
  id: string,
  arrived: boolean,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await update(ref(database, `${dayPath(key)}/appointments/${laneId}/${id}`), {
    arrived,
    checkedInAt: arrived ? Date.now() : null,
  });
}

export async function saveDailyNote(
  key: string,
  doctorId: DoctorId,
  text: string,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await set(ref(database, `${dayPath(key)}/notes/${doctorId}`), text);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

export function subscribeToPatients(
  onData: (patients: PatientMap) => void,
): () => void {
  if (!database) {
    onData({});
    return () => {};
  }
  return onValue(ref(database, "patients"), (snapshot) => {
    onData((snapshot.val() ?? {}) as PatientMap);
  });
}

/** Matches an existing patient by phone (preferred) or exact name, otherwise creates one. */
export async function findOrCreatePatient(
  patients: PatientMap,
  name: string,
  phone: string,
): Promise<string> {
  if (!database) throw new Error("Firebase is not configured");
  const normalizedPhone = normalizePhone(phone);
  const normalizedName = name.trim().toLowerCase();
  const existing = Object.entries(patients).find(([, patient]) => {
    if (normalizedPhone)
      return normalizePhone(patient.phone) === normalizedPhone;
    return patient.name.trim().toLowerCase() === normalizedName;
  });
  if (existing) {
    const [id, patient] = existing;
    if (patient.name !== name || patient.phone !== phone) {
      await update(ref(database, `patients/${id}`), {
        name,
        phone,
        updatedAt: Date.now(),
      });
    }
    return id;
  }
  const newRef = push(ref(database, "patients"));
  const now = Date.now();
  await set(newRef, { name, phone, notes: "", createdAt: now, updatedAt: now });
  return newRef.key as string;
}

export async function updatePatient(
  patientId: string,
  patch: Partial<Pick<Patient, "name" | "phone" | "notes">>,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await update(ref(database, `patients/${patientId}`), {
    ...patch,
    updatedAt: Date.now(),
  });
}

export function subscribeToPatientRecords(
  patientId: string,
  onData: (records: RecordMap) => void,
): () => void {
  if (!database) {
    onData({});
    return () => {};
  }
  return onValue(ref(database, `patients/${patientId}/records`), (snapshot) => {
    onData((snapshot.val() ?? {}) as RecordMap);
  });
}

export async function createTreatmentRecord(
  patientId: string,
  recordId: string,
  record: TreatmentRecord,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await set(ref(database, `patients/${patientId}/records/${recordId}`), record);
}

export async function updateTreatmentRecord(
  patientId: string,
  recordId: string,
  patch: Partial<Omit<TreatmentRecord, "createdAt" | "appointmentId">>,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await update(
    ref(database, `patients/${patientId}/records/${recordId}`),
    patch,
  );
}

export async function addManualTreatmentRecord(
  patientId: string,
  record: Omit<TreatmentRecord, "appointmentId">,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await set(push(ref(database, `patients/${patientId}/records`)), record);
}

export async function deleteTreatmentRecord(
  patientId: string,
  recordId: string,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await remove(ref(database, `patients/${patientId}/records/${recordId}`));
}
