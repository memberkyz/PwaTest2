import { PATIENT_GENDERS, type PatientDraft } from "./clinic";

interface PatientFieldsProps {
  draft: PatientDraft;
  onChange: (draft: PatientDraft) => void;
  /** Only the new-patient form needs a "Patient details" section label. */
  showSections?: boolean;
}

/**
 * Shared patient detail fields. Used by the create form, the edit form and
 * the profile's inline "edit details" panel so the three never drift apart.
 */
export default function PatientFields({
  draft,
  onChange,
  showSections = true,
}: PatientFieldsProps) {
  const set = <K extends keyof PatientDraft>(key: K, value: PatientDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <>
      {showSections && <p className="field-section-label">Contact</p>}
      <div className="modal-row">
        <label className="modal-field">
          <span>Full name</span>
          <input
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="e.g. Sofia Martinez"
            autoComplete="off"
            required
          />
        </label>
        <label className="modal-field">
          <span>Phone / WhatsApp</span>
          <input
            value={draft.phone}
            onChange={(event) => set("phone", event.target.value)}
            placeholder="e.g. +90 555 000 00 00"
            type="tel"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="modal-row">
        <label className="modal-field">
          <span>Email</span>
          <input
            value={draft.email}
            onChange={(event) => set("email", event.target.value)}
            placeholder="optional"
            type="email"
            autoComplete="off"
          />
        </label>
        <label className="modal-field">
          <span>Date of birth</span>
          <input
            type="date"
            value={draft.birthDate}
            onChange={(event) => set("birthDate", event.target.value)}
          />
        </label>
      </div>

      {showSections && <p className="field-section-label">Clinical</p>}
      <div className="modal-row">
        <label className="modal-field">
          <span>Gender</span>
          <select
            value={draft.gender}
            onChange={(event) =>
              set("gender", event.target.value as PatientDraft["gender"])
            }
          >
            {PATIENT_GENDERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="modal-field">
          <span>Insurance</span>
          <input
            value={draft.insurance}
            onChange={(event) => set("insurance", event.target.value)}
            placeholder="optional"
          />
        </label>
      </div>

      <label className="modal-field">
        <span>Address</span>
        <input
          value={draft.address}
          onChange={(event) => set("address", event.target.value)}
          placeholder="optional"
        />
      </label>

      <label className="modal-field">
        <span>Allergies / medical flags</span>
        <input
          value={draft.allergies}
          onChange={(event) => set("allergies", event.target.value)}
          placeholder="e.g. Penicillin, latex"
        />
      </label>

      <label className="modal-field">
        <span>Notes</span>
        <textarea
          value={draft.notes}
          onChange={(event) => set("notes", event.target.value)}
          rows={2}
          placeholder="Preferences, medical history, reminders..."
        />
      </label>
    </>
  );
}
