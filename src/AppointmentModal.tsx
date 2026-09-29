import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { type Doctor, type DoctorId, type PatientMap } from "./clinic";

export interface AppointmentDraft {
  doctorId: DoctorId;
  patientName: string;
  phone: string;
  treatment: string;
  date: string;
  start: string;
  duration: number;
  notes: string;
}

interface AppointmentModalProps {
  doctors: Doctor[];
  patients: PatientMap;
  draft: AppointmentDraft;
  isEditing: boolean;
  onCancel: () => void;
  onSave: (draft: AppointmentDraft) => void;
  onDelete?: () => void;
}

export default function AppointmentModal({
  doctors,
  patients,
  draft,
  isEditing,
  onCancel,
  onSave,
  onDelete,
}: AppointmentModalProps) {
  const [form, setForm] = useState<AppointmentDraft>(draft);
  const [nameFocused, setNameFocused] = useState(false);
  const canSave = form.patientName.trim().length > 0;

  const suggestions = useMemo(() => {
    const query = form.patientName.trim().toLowerCase();
    if (!query) return [];
    return Object.entries(patients)
      .filter(([, patient]) => patient.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [form.patientName, patients]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal-card"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          onSave(form);
        }}
      >
        <header className="modal-head">
          <h2>{isEditing ? "Edit appointment" : "New appointment"}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="modal-field patient-name-field">
          <label>
            <span>Patient name</span>
            <input
              value={form.patientName}
              onChange={(event) =>
                setForm({ ...form, patientName: event.target.value })
              }
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              placeholder="e.g. Sofia Martinez"
              autoComplete="off"
              autoFocus
              required
            />
          </label>
          {nameFocused && suggestions.length > 0 && (
            <div
              className="search-results"
              onMouseDown={(event) => event.preventDefault()}
            >
              {suggestions.map(([id, patient]) => (
                <button
                  key={id}
                  type="button"
                  className="search-result-row"
                  onClick={() => {
                    setForm({
                      ...form,
                      patientName: patient.name,
                      phone: patient.phone,
                    });
                    setNameFocused(false);
                  }}
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

        <label className="modal-field">
          <span>Phone / WhatsApp</span>
          <input
            value={form.phone}
            onChange={(event) =>
              setForm({ ...form, phone: event.target.value })
            }
            placeholder="e.g. +90 555 000 00 00"
            type="tel"
          />
        </label>

        <label className="modal-field">
          <span>Treatment</span>
          <input
            value={form.treatment}
            onChange={(event) =>
              setForm({ ...form, treatment: event.target.value })
            }
            placeholder="e.g. Endodontics, Crown/Bridge, General checkup"
          />
        </label>

        <div className="modal-row">
          <label className="modal-field">
            <span>Doctor</span>
            <select
              value={form.doctorId}
              onChange={(event) =>
                setForm({ ...form, doctorId: event.target.value as DoctorId })
              }
            >
              {doctors.map((doctor) => (
                <option value={doctor.id} key={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </label>
          <label className="modal-field">
            <span>Date</span>
            <input
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm({ ...form, date: event.target.value })
              }
              required
            />
          </label>
        </div>

        <div className="modal-row">
          <label className="modal-field">
            <span>Start time</span>
            <input
              type="time"
              step={900}
              value={form.start}
              onChange={(event) =>
                setForm({ ...form, start: event.target.value })
              }
              required
            />
          </label>
          <label className="modal-field">
            <span>Duration (minutes)</span>
            <input
              type="number"
              min={15}
              step={15}
              value={form.duration}
              onChange={(event) =>
                setForm({
                  ...form,
                  duration: Number(event.target.value) || 60,
                })
              }
            />
          </label>
        </div>

        <label className="modal-field">
          <span>Notes</span>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            rows={2}
            placeholder="Procedure notes, reminders..."
          />
        </label>

        <div className="modal-actions">
          {isEditing && onDelete && (
            <button type="button" className="modal-delete" onClick={onDelete}>
              Cancel appointment
            </button>
          )}
          <div className="modal-actions-right">
            <button type="button" className="modal-cancel" onClick={onCancel}>
              Close
            </button>
            <button type="submit" className="modal-save" disabled={!canSave}>
              {isEditing ? "Save changes" : "Create appointment"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
