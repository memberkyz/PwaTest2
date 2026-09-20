import { useState } from "react";
import {
  STATUS_OPTIONS,
  type AppointmentStatus,
  type Doctor,
  type DoctorId,
} from "./clinic";

export interface AppointmentDraft {
  doctorId: DoctorId;
  patientName: string;
  phone: string;
  treatment: string;
  status: AppointmentStatus;
  date: string;
  start: string;
  duration: number;
  notes: string;
}

interface AppointmentModalProps {
  doctors: Doctor[];
  draft: AppointmentDraft;
  isEditing: boolean;
  onCancel: () => void;
  onSave: (draft: AppointmentDraft) => void;
  onDelete?: () => void;
}

export default function AppointmentModal({
  doctors,
  draft,
  isEditing,
  onCancel,
  onSave,
  onDelete,
}: AppointmentModalProps) {
  const [form, setForm] = useState<AppointmentDraft>(draft);
  const canSave = form.patientName.trim().length > 0;

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
            ×
          </button>
        </header>

        <label className="modal-field">
          <span>Patient name</span>
          <input
            value={form.patientName}
            onChange={(event) =>
              setForm({ ...form, patientName: event.target.value })
            }
            placeholder="e.g. Sofia Martinez"
            autoFocus
            required
          />
        </label>

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
            <span>Status</span>
            <select
              value={form.status}
              onChange={(event) =>
                setForm({
                  ...form,
                  status: event.target.value as AppointmentStatus,
                })
              }
            >
              {STATUS_OPTIONS.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="modal-row">
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
        </div>
        <label className="modal-field">
          <span>Duration (minutes)</span>
          <input
            type="number"
            min={15}
            step={15}
            value={form.duration}
            onChange={(event) =>
              setForm({ ...form, duration: Number(event.target.value) || 60 })
            }
          />
        </label>

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
