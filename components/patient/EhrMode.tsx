"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { Patient } from "@/lib/types";

type DirectoryPatient = { id: string; workspaceId: string; name: string; mrn: string };

async function request<T>(path: string, signal: AbortSignal) {
  const response = await fetch(`/api/ehr/patients${path}`, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load the EHR record.");
  return data as T;
}

export function EhrMode({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>EHR Mode</button>
    {open && <EhrDirectory onClose={() => setOpen(false)} onOpenPatient={id => {
      setOpen(false);
      onOpenPatient(id);
    }} />}
  </>;
}

function EhrDirectory({ onClose, onOpenPatient }: {
  onClose: () => void;
  onOpenPatient: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const imported = useAppStore(s => s.patients);
  const [records, setRecords] = useState<DirectoryPatient[]>();
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const importRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => {
      modal?.close();
      importRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request<{ patients: DirectoryPatient[] }>("", controller.signal)
      .then(data => setRecords(data.patients))
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  async function openRecord(record: DirectoryPatient) {
    if (importRequest.current) return;
    if (imported.some(patient => patient.id === record.workspaceId)) {
      onOpenPatient(record.workspaceId);
      return;
    }
    const controller = new AbortController();
    importRequest.current = controller;
    setError("");
    setImporting(record.id);
    try {
      const { patient } = await request<{ patient: Patient }>(`/${encodeURIComponent(record.id)}`, controller.signal);
      if (controller.signal.aborted) return;
      const saved = useAppStore.getState().addImportedPatient(patient);
      onOpenPatient(saved.id);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Import failed.");
    } finally {
      importRequest.current = null;
      if (!controller.signal.aborted) setImporting(undefined);
    }
  }

  return <dialog ref={dialog} onCancel={onClose} className="workflow-dialog" aria-labelledby={title}>
    <div className="workflow-heading">
      <h2 id={title}>EHR Mode</h2>
      <button type="button" onClick={onClose} aria-label="Close EHR Mode">Close</button>
    </div>
    <p className="workflow-muted">Import a synthetic patient snapshot from OpenMRS over FHIR R4.</p>
    {loading && <p role="status">Loading EHR patients…</p>}
    {error && <p role="alert" className="workflow-error mt-3">{error}</p>}
    {records?.length === 0 && !loading && <p className="mt-3">No ClinIQ synthetic patients found in OpenMRS.</p>}
    <ul>
      {records?.map(record => <li className="workflow-row" key={record.id}>
        <div><strong>{record.name}</strong><small>{record.mrn}</small></div>
        <button type="button" disabled={loading || !!importing} onClick={() => void openRecord(record)}>
          {importing === record.id ? "Importing…" :
            imported.some(patient => patient.id === record.workspaceId) ? "Open imported record" : "Import patient"}
        </button>
      </li>)}
    </ul>
    <button className="mt-4" type="button" disabled={loading || !!importing} onClick={() => {
      setError("");
      setLoading(true);
      setReload(x => x + 1);
    }}>Refresh EHR patients</button>
  </dialog>;
}
