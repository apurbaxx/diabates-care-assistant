import { ShieldAlert } from "lucide-react";

export function SafetyFooter() {
  return (
    <footer className="border-t border-gridline bg-page px-6 py-3">
      <p className="mx-auto flex max-w-6xl items-center gap-2 text-xs text-muted">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Clinical decision support. Synthetic data. Not a medical device. All AI-generated content requires clinician
        verification before acting on it.
      </p>
    </footer>
  );
}
