import { useEffect, useMemo, useState } from "react";
import {
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  PATIENT_SORTS,
  createPatient,
  emptyPatientDraft,
  fetchAllPatientStats,
  patientMatchesQuery,
  sortPatients,
  subscribeToPatients,
  updatePatient,
  type Patient,
  type PatientDraft,
  type PatientMap,
  type PatientSort,
  type PatientStats,
} from "./clinic";
import PatientFields from "./PatientFields";
import PatientProfilePanel from "./PatientProfile";
import "./patients.css";

/** A "select this patient" request. The token makes each request unique. */
export interface PatientFocus {
  id: string;
  token: number;
}

interface PatientsPageProps {
  /** Book an appointment for a patient. */
  onSchedule: (patientId: string, patient: Patient) => void;
  /** Select a specific patient, e.g. the one just opened from the agenda. */
  focusPatient?: PatientFocus | null;
  /** Extra button rendered in the page header (back to agenda, etc). */
  headerAction?: React.ReactNode;
}

function formatRecordDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Dedicated Patients page: search, sortable list, create/edit forms, and the
 * selected patient's full profile. Everything reads and writes the same
 * `patients` node the agenda uses, so both pages stay in sync live.
 */
export default function PatientsPage({
  onSchedule,
  focusPatient,
  headerAction,
}: PatientsPageProps) {
  const [patients, setPatients] = useState<PatientMap>({});
  const [stats, setStats] = useState<Record<string, PatientStats>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PatientSort>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [draft, setDraft] = useState<PatientDraft>(emptyPatientDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => subscribeToPatients(setPatients), []);

  // Visit counts need the whole `patients` tree, so refresh them when the
  // list changes and whenever the sort depends on them.
  useEffect(() => {
    let cancelled = false;
    fetchAllPatientStats()
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [patients, sort]);

  // A patient can arrive from another page (the agenda's search) and should
  // become the selection. This is React's documented "adjust state when a
  // prop changes" pattern: setState on *this* component during render is
  // legal and re-renders before committing. The token makes each request
  // distinct, so re-picking the same patient still re-focuses it. Clearing
  // the request through a parent callback instead would be a setState on
  // another component during render, which React rejects.
  const [handledFocusToken, setHandledFocusToken] = useState(0);
  if (focusPatient && focusPatient.token !== handledFocusToken) {
    setHandledFocusToken(focusPatient.token);
    if (focusPatient.id !== selectedId) setSelectedId(focusPatient.id);
  }

  const visitCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, value] of Object.entries(stats)) counts[id] = value.visits;
    return counts;
  }, [stats]);

  const filtered = useMemo(() => {
    const entries = Object.entries(patients).filter(([, patient]) =>
      patientMatchesQuery(patient, query),
    );
    return sortPatients(entries, visitCounts, sort);
  }, [patients, query, sort, visitCounts]);

  const selected = selectedId ? patients[selectedId] : undefined;
  const selectedStats = selectedId ? stats[selectedId] : undefined;
  const totalPatients = Object.keys(patients).length;

  function openCreate() {
    setDraft(emptyPatientDraft());
    setError("");
    setFormMode("create");
  }

  function openEdit(patient: Patient) {
    setDraft({
      name: patient.name ?? "",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      birthDate: patient.birthDate ?? "",
      gender: patient.gender ?? "",
      address: patient.address ?? "",
      insurance: patient.insurance ?? "",
      allergies: patient.allergies ?? "",
      notes: patient.notes ?? "",
    });
    setError("");
    setFormMode("edit");
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError("A patient name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (formMode === "edit" && selectedId) {
        await updatePatient(selectedId, {
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
        setStatus(`Updated ${draft.name.trim()}`);
        setFormMode(null);
      } else {
        const newId = await createPatient(draft);
        setFormMode(null);
        setQuery("");
        setSelectedId(newId);
        setStatus(`Added ${draft.name.trim()}`);
      }
    } catch {
      setError("Could not save the patient. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="patients-app">
      <header className="patients-header">
        <div className="patients-title">
          <span className="patients-title-icon">
            <Users size={16} />
          </span>
          <strong>Patients</strong>
          <span className="patients-count">
            {totalPatients} record{totalPatients === 1 ? "" : "s"}
          </span>
        </div>
        <div className="patients-header-actions">
          {headerAction}
          <button
            type="button"
            className="patients-new-button"
            onClick={openCreate}
          >
            <UserPlus size={15} />
            <span>New patient</span>
          </button>
        </div>
      </header>

      {(status || error) && (
        <div className={`patients-status ${error ? "error" : ""}`}>
          {error || status}
        </div>
      )}

      <div className="patients-body">
        <section className="patients-list-pane">
          <div className="patients-search-row">
            <label className="patients-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, phone, email…"
                autoComplete="off"
                aria-label="Search patients"
              />
              {query && (
                <button
                  type="button"
                  className="patients-search-clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <select
              className="patients-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as PatientSort)}
              aria-label="Sort patients"
            >
              {PATIENT_SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="patients-list">
            {filtered.length === 0 && (
              <div className="patients-list-empty">
                {totalPatients === 0 ? (
                  <>
                    <p>No patients yet.</p>
                    <button type="button" onClick={openCreate}>
                      <UserPlus size={14} /> Add the first patient
                    </button>
                  </>
                ) : (
                  <p>No patients match “{query}”.</p>
                )}
              </div>
            )}
            {(() => {
              // Group the rows under A–Z letter headers so a long list stays
              // scannable. Turkish names are sorted with localeCompare, so
              // the letter buckets use the same collation.
              const rows: { id: string; patient: Patient; letter: string }[] =
                [];
              for (const [id, patient] of filtered) {
                const first = patient.name.trim().charAt(0).toLocaleUpperCase();
                rows.push({
                  id,
                  patient,
                  letter: /[A-ZÇĞİÖŞÜ]/.test(first) ? first : "#",
                });
              }
              let lastLetter = "";
              return rows.map(({ id, patient, letter }) => {
                const showLetter = letter !== lastLetter;
                lastLetter = letter;
                const patientStats = stats[id];
                return (
                  <div key={id} className="patients-list-group">
                    {showLetter && sort === "name" && (
                      <span className="patients-letter">{letter}</span>
                    )}
                    <button
                      type="button"
                      className={`patients-list-row ${
                        selectedId === id ? "active" : ""
                      }`}
                      onClick={() => setSelectedId(id)}
                    >
                      <span className="patients-row-avatar">
                        {initials(patient.name)}
                      </span>
                      <span className="patients-row-info">
                        <strong>{patient.name}</strong>
                        <small>
                          {patient.phone || patient.email || "No contact on file"}
                        </small>
                      </span>
                      <span className="patients-row-meta">
                        {patientStats?.lastVisit && (
                          <span className="patients-row-last">
                            {formatRecordDate(patientStats.lastVisit)}
                          </span>
                        )}
                        {patientStats ? (
                          <span className="patients-row-visits">
                            {patientStats.visits} visit
                            {patientStats.visits === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </div>
                );
              });
            })()}
          </div>
        </section>

        <section className="patients-detail-pane">
          {formMode ? (
            <form className="patients-form" onSubmit={submitForm}>
              <header className="patients-form-head">
                <h2>
                  {formMode === "create" ? "New patient" : "Edit patient"}
                </h2>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setFormMode(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </header>
              <p className="patients-form-hint">
                Only the name is required — fill in the rest as you learn it.
              </p>
              <PatientFields draft={draft} onChange={setDraft} />
              {error && <p className="patients-form-error">{error}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-cancel"
                  onClick={() => setFormMode(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-save"
                  disabled={saving || !draft.name.trim()}
                >
                  {saving
                    ? "Saving…"
                    : formMode === "create"
                      ? "Create patient"
                      : "Save changes"}
                </button>
              </div>
            </form>
          ) : selectedId && selected ? (
            <>
              <div className="patients-detail-bar">
                <span className="patients-detail-stats">
                  <strong>{selectedStats?.visits ?? 0}</strong> visit
                  {selectedStats?.visits === 1 ? "" : "s"}
                  {selectedStats?.lastVisit && (
                    <>
                      {" · last "}
                      {formatRecordDate(selectedStats.lastVisit)}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  className="profile-action"
                  onClick={() => openEdit(selected)}
                >
                  Edit details
                </button>
              </div>
              <PatientProfilePanel
                // Remounting per patient resets the form/edit state cleanly.
                key={selectedId}
                patientId={selectedId!}
                patient={selected}
                onSchedule={onSchedule}
                onDeleted={() => {
                  setSelectedId(null);
                  setStatus("Patient deleted");
                }}
              />
            </>
          ) : (
            <div className="patients-detail-empty">
              <span className="patients-detail-empty-icon">
                <Users size={22} />
              </span>
              <h2>No patient selected</h2>
              <p>
                Search or pick a patient on the left to see their contact
                details, clinical notes and full treatment history.
              </p>
              <button type="button" onClick={openCreate}>
                <UserPlus size={14} /> New patient
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
