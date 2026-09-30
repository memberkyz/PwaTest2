import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  DOCTORS,
  addManualTreatmentRecord,
  deleteTreatmentRecord,
  subscribeToPatientRecords,
  updatePatient,
  dateKey,
  laneMeta,
  type DoctorId,
  type LaneId,
  type Patient,
  type RecordMap,
} from "./clinic";

interface PatientProfileProps {
  patientId: string;
  patient: Patient;
  onClose: () => void;
  onSchedule: (patientId: string, patient: Patient) => void;
}

function formatRecordDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function doctorName(id: LaneId): string {
  return laneMeta(id).name;
}

export default function PatientProfile({
  patientId,
  patient,
  onClose,
  onSchedule,
}: PatientProfileProps) {
  const [records, setRecords] = useState<RecordMap>({});
  const [name, setName] = useState(patient.name);
  const [phone, setPhone] = useState(patient.phone);
  const [notes, setNotes] = useState(patient.notes);
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

  const sortedRecords = Object.entries(records).sort(([, a], [, b]) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt;
  });

  async function saveDetails() {
    setSavingDetails(true);
    try {
      await updatePatient(patientId, {
        name: name.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
      });
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card patient-profile"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Patient record</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="modal-row">
          <label className="modal-field">
            <span>Patient name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="modal-field">
            <span>Phone / WhatsApp</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
            />
          </label>
        </div>
        <label className="modal-field">
          <span>Clinical notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Allergies, medical history, preferences..."
          />
        </label>
        <div className="modal-actions">
          <button
            type="button"
            className="modal-save"
            onClick={() => void saveDetails()}
            disabled={savingDetails}
          >
            {savingDetails ? "Saving..." : "Save details"}
          </button>
          <button
            type="button"
            className="modal-cancel"
            onClick={() => onSchedule(patientId, patient)}
          >
            Schedule appointment
          </button>
        </div>

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
                  <small>{doctorName(record.doctorId)}</small>
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
    </div>
  );
}
