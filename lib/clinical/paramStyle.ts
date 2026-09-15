import { Droplet, Flame, Scale, HeartPulse, Waves, FlaskConical, TestTube, Beaker, type LucideIcon } from "lucide-react";

/**
 * Shared visual identity per parameter — used anywhere a lab/vital value is
 * shown (stat tiles, timeline readouts, trend tabs, comparison tables) so the
 * same metric always carries the same icon/colour across the app.
 */
export interface ParamStyle {
  icon: LucideIcon;
  /** Tailwind classes for a tinted tile (border + bg + text). */
  tint: string;
  /** CSS colour for chart lines / icon-only usage, matching the tint's text shade. */
  accent: string;
}

const DEFAULT_STYLE: ParamStyle = {
  icon: Beaker,
  tint: "border-border bg-page text-ink-secondary",
  accent: "var(--color-brand-500)",
};

const PARAM_STYLE: Record<string, ParamStyle> = {
  hba1c: { icon: Droplet, tint: "border-rose-200/60 bg-rose-50 text-rose-700", accent: "#be123c" },
  fastingGlucose: { icon: Flame, tint: "border-amber-200/60 bg-amber-50 text-amber-700", accent: "#b45309" },
  randomGlucose: { icon: Flame, tint: "border-amber-200/60 bg-amber-50 text-amber-700", accent: "#b45309" },
  postprandialGlucose: { icon: Flame, tint: "border-amber-200/60 bg-amber-50 text-amber-700", accent: "#b45309" },
  weightKg: { icon: Scale, tint: "border-violet-200/60 bg-violet-50 text-violet-700", accent: "#6d28d9" },
  systolic: { icon: HeartPulse, tint: "border-sky-200/60 bg-sky-50 text-sky-700", accent: "#0369a1" },
  diastolic: { icon: HeartPulse, tint: "border-sky-200/60 bg-sky-50 text-sky-700", accent: "#0369a1" },
  egfr: { icon: Waves, tint: "border-emerald-200/60 bg-emerald-50 text-emerald-700", accent: "#047857" },
  creatinine: { icon: Waves, tint: "border-emerald-200/60 bg-emerald-50 text-emerald-700", accent: "#047857" },
  uacr: { icon: FlaskConical, tint: "border-teal-200/60 bg-teal-50 text-teal-700", accent: "#0f766e" },
  ldl: { icon: TestTube, tint: "border-fuchsia-200/60 bg-fuchsia-50 text-fuchsia-700", accent: "#a21caf" },
  hdl: { icon: TestTube, tint: "border-fuchsia-200/60 bg-fuchsia-50 text-fuchsia-700", accent: "#a21caf" },
  triglycerides: { icon: TestTube, tint: "border-fuchsia-200/60 bg-fuchsia-50 text-fuchsia-700", accent: "#a21caf" },
  potassium: { icon: Beaker, tint: "border-slate-200/60 bg-slate-50 text-slate-700", accent: "#334155" },
};

export function paramStyle(key: string): ParamStyle {
  return PARAM_STYLE[key] ?? DEFAULT_STYLE;
}
