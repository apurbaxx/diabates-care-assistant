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
  hba1c: { icon: Droplet, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  fastingGlucose: { icon: Flame, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  randomGlucose: { icon: Flame, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  postprandialGlucose: { icon: Flame, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  weightKg: { icon: Scale, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  systolic: { icon: HeartPulse, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  diastolic: { icon: HeartPulse, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  egfr: { icon: Waves, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  creatinine: { icon: Waves, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  uacr: { icon: FlaskConical, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  ldl: { icon: TestTube, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  hdl: { icon: TestTube, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  triglycerides: { icon: TestTube, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
  potassium: { icon: Beaker, tint: "border-brand-200 bg-brand-100/20 text-brand-700", accent: "#28649b" },
};

export function paramStyle(key: string): ParamStyle {
  return PARAM_STYLE[key] ?? DEFAULT_STYLE;
}
