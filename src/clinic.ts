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

export type AppointmentStatus =
  | "Scheduled"
  | "Waiting"
  | "Completed"
  | "Cancelled";

export const STATUS_OPTIONS: AppointmentStatus[] = [
  "Scheduled",
  "Waiting",
  "Completed",
  "Cancelled",
];

export interface Appointment {
  patientName: string;
  phone: string;
  treatment: string;
  status: AppointmentStatus;
  start: string; // "HH:mm", 15-minute granularity
  duration: number; // minutes
  notes: string;
  updatedAt: number;
  patientId?: string;
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
  doctorId: DoctorId;
  treatment: string;
  status: AppointmentStatus;
  notes: string;
  createdAt: number;
  appointmentId?: string;
}

export type AppointmentMap = Record<string, Appointment>;
export type DayAppointments = Record<DoctorId, AppointmentMap>;
export type DayNotes = Record<DoctorId, string>;
export type DayCounts = Record<DoctorId, number>;
export type PatientMap = Record<string, Patient>;
export type RecordMap = Record<string, TreatmentRecord>;

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

const EMPTY_APPOINTMENTS: DayAppointments = { berkay: {}, kagan: {} };
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
      onAppointments({ berkay: value.berkay ?? {}, kagan: value.kagan ?? {} });
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
  if (!database) return { berkay: 0, kagan: 0 };
  const snapshot = await get(ref(database, `${dayPath(key)}/appointments`));
  const value = (snapshot.val() ?? {}) as Partial<DayAppointments>;
  return {
    berkay: Object.keys(value.berkay ?? {}).length,
    kagan: Object.keys(value.kagan ?? {}).length,
  };
}

export async function createAppointment(
  key: string,
  doctorId: DoctorId,
  appointment: Appointment,
): Promise<string> {
  if (!database) throw new Error("Firebase is not configured");
  const newRef = push(
    ref(database, `${dayPath(key)}/appointments/${doctorId}`),
  );
  await set(newRef, appointment);
  return newRef.key as string;
}

export async function updateAppointment(
  key: string,
  doctorId: DoctorId,
  id: string,
  appointment: Appointment,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await set(
    ref(database, `${dayPath(key)}/appointments/${doctorId}/${id}`),
    appointment,
  );
}

export async function moveAppointment(
  key: string,
  fromDoctorId: DoctorId,
  toDoctorId: DoctorId,
  id: string,
  appointment: Appointment,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  if (fromDoctorId === toDoctorId) {
    await set(
      ref(database, `${dayPath(key)}/appointments/${toDoctorId}/${id}`),
      appointment,
    );
    return;
  }
  await update(ref(database), {
    [`${dayPath(key)}/appointments/${fromDoctorId}/${id}`]: null,
    [`${dayPath(key)}/appointments/${toDoctorId}/${id}`]: appointment,
  });
}

/** Like moveAppointment, but can also relocate the appointment to a different day. */
export async function relocateAppointment(
  fromKey: string,
  toKey: string,
  fromDoctorId: DoctorId,
  toDoctorId: DoctorId,
  id: string,
  appointment: Appointment,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  if (fromKey === toKey && fromDoctorId === toDoctorId) {
    await set(
      ref(database, `${dayPath(toKey)}/appointments/${toDoctorId}/${id}`),
      appointment,
    );
    return;
  }
  await update(ref(database), {
    [`${dayPath(fromKey)}/appointments/${fromDoctorId}/${id}`]: null,
    [`${dayPath(toKey)}/appointments/${toDoctorId}/${id}`]: appointment,
  });
}

export async function deleteAppointment(
  key: string,
  doctorId: DoctorId,
  id: string,
): Promise<void> {
  if (!database) throw new Error("Firebase is not configured");
  await remove(ref(database, `${dayPath(key)}/appointments/${doctorId}/${id}`));
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
