import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  DOCTORS,
  addManualTreatmentRecord,
  deletePatient,
  deleteTreatmentRecord,
  dateKey,
  laneMeta,
  patientToDraft,
  subscribeToPatientRecords,
  updatePatient,
  type DoctorId,
  type Patient,
  type PatientDraft,
  type RecordMap,
} from "./clinic";
import PatientFields from "./PatientFields";

export interface PatientProfilePanelProps {
  patientId: string;
  patient: Patient;
  onSchedule: (patientId: string, patient: Patient) => void;
  /** Called after the patient is deleted so the host can clear selection. */
  onDeleted?: () => void;
  /** Small top-right close button. Omit when the panel is already a page. */
  onClose?: () => void;
}

const GENDER_LABELS: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
};

function formatRecordDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ageFrom(birthDate?: string): string | null {
  if (!birthDate) return null;
  const [year, month, day] = birthDate.split("-").map(Number);
  if (!year) return null;
  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) age -= 1;
  return age >= 0 ? `${age} yrs` : null;
}

function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

function contactItems(patient: Patient) {
  return [
    { label: "Phone", value: patient.phone },
    { label: "Email", value: patient.email },
    { label: "Insurance", value: patient.insurance },
    { label: "Address", value: patient.address },
  ].filter((item) => Boolean(item.value));
}

/**
 * The full patient record: editable details on top, permanent treatment
 * history below. Rendered both as a modal over the agenda and inline in the
 * dedicated Patients page, so the two entry points stay identical.
 */
export default function PatientProfilePanel({
  patientId,
  patient,
  onSchedule,
  onDeleted,
  onClose,
}: PatientProfilePanelProps) {
  const [records, setRecords] = useState<RecordMap>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PatientDraft>(() =>
    patientToDraft(patient),
  );
  const [savingDetails, setSavingDetails] = useState(false);
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [recordDate, setRecordDate] = useState(() => dateKey(new Date()));
  const [recordDoctor, setRecordDoctor] = useState<DoctorId>(DOCTORS[0].id);
  const [recordTreatment, setRecordTreatment] = useState("");
  const [recordNotes, setRecordNotes] = useState("");

  useEffect(
    () => subscribeToPatientRecords(patientId, setRecords),
    [patientId],
  );

  const sortedRecords = useMemo(
    () =>
      Object.entries(records).sort(([, a], [, b]) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return b.createdAt - a.createdAt;
      }),
    [records],
  );

  const lastVisit = sortedRecords[0]?.[1].date ?? null;
  const age = ageFrom(patient.birthDate);
  const contacts = contactItems(patient);

  async function saveDetails() {
    if (!draft.name.trim()) return;
    setSavingDetails(true);
    try {
      await updatePatient(patientId, {
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        birthDate: draft.birthDate,
        gender: draft.gender,
        address: draft.address.trim(),
        insurance: draft.insurance.trim(),
        allergies: draft.allergies.trim(),
        notes: draft.notes.trim(),
      });
      setEditing(false);
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveNewRecord() {
    if (!recordTreatment.trim()) return;
    await addManualTreatmentRecord(patientId, {
      date: recordDate,
      doctorId: recordDoctor,
      treatment: recordTreatment.trim(),
      notes: recordNotes.trim(),
      createdAt: Date.now(),
    });
    setRecordTreatment("");
    setRecordNotes("");
    setShowAddRecord(false);
  }

  async function removeRecord(recordId: string) {
    if (!window.confirm("Remove this treatment record?")) return;
    await deleteTreatmentRecord(patientId, recordId);
  }

  async function removePatient() {
    if (
      !window.confirm(
        `Delete ${patient.name} and their full treatment history?\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    await deletePatient(patientId);
    onDeleted?.();
  }

  return (
    <div className="profile-panel">
      <header className="profile-head">
        <span className="profile-avatar">
          {(patient.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="profile-head-info">
          <strong>{patient.name}</strong>
          <small>
            {[
              age,
              patient.gender ? GENDER_LABELS[patient.gender] : null,
              lastVisit ? `Last visit ${formatRecordDate(lastVisit)}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "No visits recorded yet"}
          </small>
        </div>
        <div className="profile-head-actions">
          <button
            type="button"
            className="profile-action primary"
            onClick={() => onSchedule(patientId, patient)}
          >
            <CalendarPlus size={14} />
            <span>Schedule</span>
          </button>
          <button
            type="button"
            className="profile-action"
            onClick={() => setEditing((value) => !value)}
            aria-pressed={editing}
          >
            <Pencil size={14} />
            <span>{editing ? "Cancel" : "Edit"}</span>
          </button>
          {onClose && (
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>

      {patient.phone && (
        <div className="profile-contact-actions">
          <a className="profile-contact call" href={`tel:${patient.phone}`}>
            <Phone size={13} /> Call
          </a>
          <a
            className="profile-contact whatsapp"
            href={whatsappHref(patient.phone)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={13} /> WhatsApp
          </a>
        </div>
      )}

      {editing ? (
        <div className="profile-edit-form">
          <PatientFields draft={draft} onChange={setDraft} />
          <div className="modal-actions">
            <button
              type="button"
              className="modal-cancel danger"
              onClick={() => void removePatient()}
            >
              <Trash2 size={13} /> Delete patient
            </button>
            <div className="modal-actions-right">
              <button
                type="button"
                className="modal-cancel"
                onClick={() => {
                  setDraft(patientToDraft(patient));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-save"
                onClick={() => void saveDetails()}
                disabled={savingDetails || !draft.name.trim()}
              >
                {savingDetails ? "Saving..." : "Save details"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="profile-summary">
          {contacts.length > 0 && (
            <dl className="profile-details">
              {contacts.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
              {patient.birthDate && (
                <div>
                  <dt>Born</dt>
                  <dd>{formatRecordDate(patient.birthDate)}</dd>
                </div>
              )}
            </dl>
          )}
          {patient.allergies?.trim() && (
            <p className="profile-alert">
              <strong>Allergies</strong> {patient.allergies}
            </p>
          )}
          {patient.notes?.trim() && (
            <p className="profile-notes">{patient.notes}</p>
          )}
          {contacts.length === 0 &&
            !patient.birthDate &&
            !patient.notes?.trim() &&
            !patient.allergies?.trim() && (
              <p className="record-empty">No details on file yet.</p>
            )}
        </div>
      )}

      <div className="profile-history">
        <div className="profile-history-head">
          <h3>Treatment history</h3>
          <button
            type="button"
            className="add-note-link"
            onClick={() => setShowAddRecord((value) => !value)}
          >
            <Plus size={12} /> Add past treatment
          </button>
        </div>

        {showAddRecord && (
          <div className="record-form">
            <div className="modal-row">
              <label className="modal-field">
                <span>Date</span>
                <input
                  type="date"
                  value={recordDate}
                  onChange={(event) => setRecordDate(event.target.value)}
                />
              </label>
              <label className="modal-field">
                <span>Doctor</span>
                <select
                  value={recordDoctor}
                  onChange={(event) =>
                    setRecordDoctor(event.target.value as DoctorId)
                  }
                >
                  {DOCTORS.map((doctor) => (
                    <option value={doctor.id} key={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="modal-field">
              <span>Treatment</span>
              <input
                value={recordTreatment}
                onChange={(event) => setRecordTreatment(event.target.value)}
                placeholder="e.g. Root canal, Tooth 16"
              />
            </label>
            <label className="modal-field">
              <span>Notes</span>
              <textarea
                value={recordNotes}
                onChange={(event) => setRecordNotes(event.target.value)}
                rows={2}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-cancel"
                onClick={() => setShowAddRecord(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-save"
                onClick={() => void saveNewRecord()}
                disabled={!recordTreatment.trim()}
              >
                Save record
              </button>
            </div>
          </div>
        )}

        <div className="record-list">
          {sortedRecords.length === 0 && (
            <p className="record-empty">No treatment records yet.</p>
          )}
          {sortedRecords.map(([recordId, record]) => (
            <article
              className={`record-row ${record.cancelled ? "cancelled" : ""}`}
              key={recordId}
            >
              <div className="record-row-main">
                <strong>{formatRecordDate(record.date)}</strong>
                <span>{record.treatment || "Visit"}</span>
                <small>{laneMeta(record.doctorId).name}</small>
              </div>
              {record.notes && <p className="record-notes">{record.notes}</p>}
              <div className="record-row-side">
                {record.cancelled && (
                  <span className="status-chip">Cancelled</span>
                )}
                <button
                  type="button"
                  className="record-remove"
                  onClick={() => void removeRecord(recordId)}
                  aria-label="Remove record"
                >
                  <X size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
