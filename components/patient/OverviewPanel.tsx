import { User, Droplets, Calendar, Cigarette, ClipboardList, Syringe, Pill, ChevronRight } from "lucide-react";
import type { EngineResult, Patient, ParameterSeriesPoint } from "@/lib/types";
import { ageAt } from "@/lib/clinical/derive";
import { formatWithUnit } from "@/lib/clinical/units";
import { paramStyle } from "@/lib/clinical/paramStyle";
import { AiMarker } from "@/components/shared/Badges";
import { Sparkline } from "@/components/shared/Sparkline";
import { cn } from "@/lib/cn";

const COMORBIDITY_LABEL: Record<string, string> = {
  hypertension: "Hypertension",
  dyslipidemia: "Dyslipidaemia",
  ckd: "Chronic kidney disease",
  ascvd: "ASCVD",
  "heart-failure": "Heart failure",
  obesity: "Obesity",
  retinopathy: "Retinopathy",
  neuropathy: "Neuropathy",
  nafld: "NAFLD",
  hypothyroidism: "Hypothyroidism",
  depression: "Depression",
};

function StatTile({
  label,
  value,
  unit,
  sub,
  previousLabel,
  paramKey,
  points,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  previousLabel?: string;
  paramKey: string;
  points?: ParameterSeriesPoint[];
}) {
  const { icon: Icon, tint, accent } = paramStyle(paramKey);
  return (
    <div className={cn("rounded-xl border p-4", tint)}>
      {/* Header row: icon + label */}
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide opacity-80">
        <Icon className="h-4 w-4 shrink-0" strokeWidth={2.25} />
        {label}
      </div>

      {/* Value + sparkline row */}
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums text-ink leading-none">
            {value}
            {unit && <span className="ml-1 text-sm font-medium text-ink-secondary">{unit}</span>}
          </div>
          {sub && <div className="mt-1 text-xs text-ink-secondary">{sub}</div>}
          {previousLabel && (
            <div className="mt-1.5 text-xs text-muted">{previousLabel}</div>
          )}
        </div>
        {points && points.length >= 2 && (
          <div className="shrink-0" style={{ color: accent }}>
            <Sparkline points={points} />
          </div>
        )}
      </div>
    </div>
  );
}

export function OverviewPanel({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const { derived, summary } = engine;
  const latestVisit = derived.latestVisit;
  const prevVisit = derived.previousVisit;

  const age = ageAt(patient.dob, new Date().toISOString().slice(0, 10));

  // Build "Previous: X" labels
  function prevHba1c() {
    const v = prevVisit?.labs.hba1c;
    const d = prevVisit?.date;
    if (!v) return undefined;
    return `Previous: ${formatWithUnit("hba1c", v)}${d ? ` (${d})` : ""}`;
  }
  function prevGlucose() {
    const v = prevVisit?.labs.fastingGlucose;
    if (!v) return undefined;
    return `Previous: ${formatWithUnit("fastingGlucose", v)}`;
  }
  function prevBP() {
    if (!prevVisit?.vitals.systolic) return undefined;
    return `Previous: ${prevVisit.vitals.systolic}/${prevVisit.vitals.diastolic} mmHg`;
  }
  function prevEgfr() {
    if (!prevVisit) return undefined;
    const prev = engine.trends.egfr?.points?.slice(-2, -1)[0]?.value;
    if (!prev) return undefined;
    return `Previous: ${prev.toFixed(0)}`;
  }
  function prevUacr() {
    const v = prevVisit?.labs.uacr;
    if (!v) return undefined;
    return `Previous: ${formatWithUnit("uacr", v)}`;
  }
  function prevWeight() {
    const v = prevVisit?.vitals.weightKg;
    if (!v) return undefined;
    return `Previous: ${v.toFixed(1)} kg`;
  }

  // Medications from latest visit
  const currentMeds = latestVisit?.medications ?? [];
  const insulinMeds = currentMeds.filter(
    (m) => m.medClass === "basal-insulin" || m.medClass === "bolus-insulin" || m.medClass === "premix-insulin",
  );
  const otherMeds = currentMeds.filter(
    (m) => m.medClass !== "basal-insulin" && m.medClass !== "bolus-insulin" && m.medClass !== "premix-insulin",
  );

  return (
    <div className="space-y-6">
      {/* ── AI Summary ── */}
      <div className="rounded-xl border border-brand-300/60 bg-brand-100/25 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <AiMarker label="AI Summary" />
          <span className="text-xs text-muted">
            Generated from this record — review all details on the below.
          </span>
        </div>
        <h2 className="text-base font-semibold text-ink">{summary.headline}</h2>
        <div className="mt-2 space-y-2">
          {summary.paragraphs.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink-secondary">
              {p}
            </p>
          ))}
        </div>
      </div>

      {/* ── Metric tiles: 3 columns × 2 rows ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">
          Latest measurements{latestVisit ? ` (${latestVisit.date})` : ""}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="HbA1c"
            value={latestVisit?.labs.hba1c != null ? `${latestVisit.labs.hba1c}` : "—"}
            unit={latestVisit?.labs.hba1c != null ? "%" : undefined}
            paramKey="hba1c"
            points={engine.trends.hba1c?.points}
            previousLabel={prevHba1c()}
          />
          <StatTile
            label="Fasting glucose"
            value={latestVisit?.labs.fastingGlucose != null ? `${latestVisit.labs.fastingGlucose}` : "—"}
            unit={latestVisit?.labs.fastingGlucose != null ? "mg/dL" : undefined}
            paramKey="fastingGlucose"
            points={engine.trends.fastingGlucose?.points}
            previousLabel={prevGlucose()}
          />
          <StatTile
            label="Blood pressure"
            value={
              latestVisit?.vitals.systolic
                ? `${latestVisit.vitals.systolic}/${latestVisit.vitals.diastolic}`
                : "—"
            }
            unit={latestVisit?.vitals.systolic ? "mmHg" : undefined}
            paramKey="systolic"
            points={engine.trends.systolic?.points}
            previousLabel={prevBP()}
          />
          <StatTile
            label="eGFR"
            value={derived.egfr ? `${derived.egfr.toFixed(0)}` : "—"}
            unit={derived.egfr ? "mL/min/1.73m²" : undefined}
            sub={derived.ckdStage}
            paramKey="egfr"
            points={engine.trends.egfr?.points}
            previousLabel={prevEgfr()}
          />
          <StatTile
            label="UACR"
            value={latestVisit?.labs.uacr != null ? `${latestVisit.labs.uacr}` : "—"}
            unit={latestVisit?.labs.uacr != null ? "mg/g" : undefined}
            sub={derived.albuminuriaStage}
            paramKey="uacr"
            points={engine.trends.uacr?.points}
            previousLabel={prevUacr()}
          />
          <StatTile
            label="Weight / BMI"
            value={latestVisit?.vitals.weightKg ? `${latestVisit.vitals.weightKg.toFixed(1)}` : "—"}
            unit={latestVisit?.vitals.weightKg ? "kg" : undefined}
            sub={derived.bmi ? `BMI ${derived.bmi.toFixed(1)}` : undefined}
            paramKey="weightKg"
            points={engine.trends.weightKg?.points}
            previousLabel={prevWeight()}
          />
        </div>
      </div>

      {/* ── Patient info + Treatment side-by-side ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Patient information */}
        <div className="rounded-xl border border-gridline bg-page p-5">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-ink">Patient information</h3>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            {/* Age / Sex */}
            <div className="flex items-center gap-2 text-muted">
              <User className="h-3.5 w-3.5 shrink-0" />
              <dt className="text-xs">Age / Sex</dt>
            </div>
            <dd className="text-ink font-medium">
              {age} · {patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)}
            </dd>

            {/* MRN */}
            <div className="flex items-center gap-2 text-muted">
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              <dt className="text-xs">MRN</dt>
            </div>
            <dd className="text-ink font-medium">{patient.mrn}</dd>

            {/* Diabetes type */}
            <div className="flex items-center gap-2 text-muted">
              <Droplets className="h-3.5 w-3.5 shrink-0" />
              <dt className="text-xs">Diabetes type</dt>
            </div>
            <dd className="text-ink font-medium capitalize">
              {patient.diabetesType.replace(/-/g, " ")}
            </dd>

            {/* Diagnosed */}
            <div className="flex items-center gap-2 text-muted">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <dt className="text-xs">Diagnosed</dt>
            </div>
            <dd className="text-ink font-medium">
              {patient.diagnosisDate} ({derived.diabetesDurationYears.toFixed(1)} y)
            </dd>

            {/* Duration */}
            <div className="flex items-center gap-2 text-muted">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <dt className="text-xs">Duration</dt>
            </div>
            <dd className="text-ink font-medium">
              {derived.diabetesDurationYears.toFixed(1)} years
            </dd>

            {/* Smoking */}
            <div className="flex items-center gap-2 text-muted">
              <Cigarette className="h-3.5 w-3.5 shrink-0" />
              <dt className="text-xs">Smoking</dt>
            </div>
            <dd className="text-ink font-medium capitalize">{patient.smoking}</dd>
          </dl>

          {/* Comorbidities */}
          <div className="mt-4 border-t border-gridline pt-3">
            <dt className="mb-1 text-xs text-muted">Comorbidities</dt>
            <dd className="text-sm text-ink font-medium">
              {patient.comorbidities.length > 0
                ? patient.comorbidities.map((c) => COMORBIDITY_LABEL[c] ?? c).join(", ")
                : "None recorded"}
            </dd>
          </div>
        </div>

        {/* Current Treatment & Regimen */}
        <div className="rounded-xl border border-gridline bg-page p-5">
          <div className="mb-4 flex items-center gap-2">
            <Syringe className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-ink">Current Treatment &amp; Regimen</h3>
          </div>

          {currentMeds.length === 0 ? (
            <p className="text-sm text-muted">No medications recorded.</p>
          ) : (
            <div className="space-y-3">
              {/* Insulin regimen */}
              {insulinMeds.length > 0 && (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-gridline bg-surface p-3">
                  <div className="flex items-start gap-2.5">
                    <Syringe className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                    <div>
                      <div className="text-sm font-semibold text-ink">Insulin regimen</div>
                      <div className="mt-1 space-y-0.5">
                        {insulinMeds.map((m) => (
                          <div key={m.id} className="text-xs text-ink-secondary">
                            {m.medClass === "basal-insulin" ? "Basal" : m.medClass === "bolus-insulin" ? "Bolus" : "Premix"}
                            : {m.name} ({m.dose}
                            {m.unit} {m.frequency})
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                </div>
              )}

              {/* Other medications */}
              <div className="flex items-start justify-between gap-3 rounded-lg border border-gridline bg-surface p-3">
                <div className="flex items-start gap-2.5">
                  <Pill className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <div>
                    <div className="text-sm font-semibold text-ink">Other medications</div>
                    <div className="mt-1 space-y-0.5">
                      {otherMeds.length > 0 ? (
                        otherMeds.map((m) => (
                          <div key={m.id} className="text-xs text-ink-secondary">
                            {m.name} {m.dose}
                            {m.unit} {m.frequency}
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-muted">None recorded</div>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
