import type { ReactNode } from "react";

export const controlClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:opacity-50";
export function Action({ children, primary, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...props} className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${primary ? "border-brand-500 bg-brand-500 text-white hover:bg-brand-600" : "border-border bg-surface text-ink hover:bg-page"} ${props.className || ""}`}>{children}</button>;
}
export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-gridline bg-surface p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-ink">{title}</h2>{action}</div>{children}</section>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">{children}</p>;
}
export function Feedback({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return <p role={error ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-brand-200 bg-brand-100/30 text-brand-700"}`}>{error || message}</p>;
}
