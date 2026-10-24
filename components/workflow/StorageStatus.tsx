"use client";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import Link from "next/link";

export function StorageStatus() {
  const storedError = useAppStore(s => s.storageError);
  const [error, setError] = useState("");
  useEffect(() => {
    const failure = (e: Event) => setError((e as CustomEvent<string>).detail);
    const synchronize = (e: StorageEvent) => { if (e.key === "diabetes-care-assistant-store") { if (e.newValue) void useAppStore.persist.rehydrate(); else setError("ClinIQ records were removed from browser storage in another tab. Download a backup from the open worklist before closing this page."); } };
    window.addEventListener("cliniq-storage-error", failure); window.addEventListener("storage", synchronize);
    return () => { window.removeEventListener("cliniq-storage-error", failure); window.removeEventListener("storage", synchronize); };
  }, []);
  return storedError || error ? <div role="alert" className="sticky top-0 z-50 border-b border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">{storedError || error} <Link href="/#workflow-tasks" className="underline">Open worklist and backups</Link></div> : null;
}
