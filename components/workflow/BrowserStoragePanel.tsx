"use client";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { createBackup, restoreBackup } from "@/lib/browser/backup";
import { downloadBlob } from "@/lib/browser/files";
import { Action, Feedback } from "./WorkflowUI";

export function BrowserStoragePanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const storageError = useAppStore(s => s.storageError);
  useEffect(() => {
    const failure = (e: Event) => setError((e as CustomEvent<string>).detail);
    window.addEventListener("cliniq-storage-error", failure);
    return () => window.removeEventListener("cliniq-storage-error", failure);
  }, []);
  async function backup() {
    setBusy(true); setError(""); setMessage("");
    try {
      const { patients, appointments, summaries, tasks } = useAppStore.getState();
      const data = await createBackup({ patients, appointments, summaries, tasks });
      downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `cliniq-backup-${new Date().toISOString().slice(0,10)}.json`);
      setMessage("Backup downloaded with patient records, workflows and original report files");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function restore(file: File) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Backups must be under 100 MB");
      const records = await restoreBackup(JSON.parse(await file.text()));
      useAppStore.getState().mergeBackup(records);
      setMessage("Backup merged. Existing record IDs and clinician edits were preserved.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-gridline bg-surface p-4"><summary className="cursor-pointer text-sm font-semibold">Browser storage and backups</summary><div className="mt-3 space-y-3">
    <p className="text-xs text-muted">Records use this browser&apos;s localStorage; uploaded files use IndexedDB. They survive reloads and Heroku restarts. Clearing site data, private browsing expiry or device loss can remove them. Download backups to retain a copy. No patient database or account synchronization is configured.</p>
    <Feedback error={storageError || error} message={message} />
    <div className="flex flex-wrap items-center gap-3"><Action disabled={busy} onClick={backup}>Download complete backup</Action><label className="cursor-pointer text-sm text-brand-700 underline">Restore backup<input aria-label="Restore ClinIQ backup" disabled={busy} type="file" accept=".json" className="ml-2 max-w-52 text-xs" onChange={e => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ""; }} /></label><Action disabled={busy} onClick={async () => { try { const granted = await navigator.storage?.persist?.(); setMessage(granted ? "Persistent browser storage granted" : "The browser did not grant persistent storage. Keep downloaded backups."); } catch { setError("Persistent storage is unavailable in this browser"); } }}>Request persistent browser storage</Action></div>
    {busy && <p role="status" className="text-xs text-brand-700">Processing browser backup…</p>}
  </div></details>;
}
