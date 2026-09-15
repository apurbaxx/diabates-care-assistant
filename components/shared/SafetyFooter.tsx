import { ShieldAlert } from "lucide-react";

export function SafetyFooter() {
  return (
    <footer className="border-t border-gridline bg-page px-6 py-3">
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 text-xs text-muted text-center">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        Assistive tool for clinician review. Synthetic data only — not a medical device. Every item traces to the
        record shown; interpretation and decisions remain with the treating clinician.
      </p>
    </footer>
  );
}
