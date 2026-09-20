import { CalendarClock, FileText, ChevronRight } from "lucide-react";
import type { EngineResult, Patient, ParameterSeriesPoint } from "@/lib/types";
import { ageAt } from "@/lib/clinical/derive";
import { formatWithUnit } from "@/lib/clinical/units";
import { paramStyle } from "@/lib/clinical/paramStyle";
import { AiMarker } from "@/components/shared/Badges";
import { GuidelineCitation } from "@/components/shared/GuidelineCitation";
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
  sub,
  paramKey,
  points,
}: {
  label: string;
  value: string;
  sub?: string;
  paramKey: string;
  points?: ParameterSeriesPoint[];
}) {
  const { icon: Icon, tint } = paramStyle(paramKey);
  return (
    <div className={cn("rounded-xl border p-3", tint)}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
        {label}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
          {sub && <div className="text-xs text-ink-secondary">{sub}</div>}
        </div>
        {points && points.length >= 2 && <Sparkline points={points} />}
      </div>
    </div>
  );
}

export function OverviewPanel({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const { derived, summary } = engine;
  const latestVisit = derived.latestVisit;

  const recentReports = [...patient.labReports].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        {/* AI summary */}
        <div className="rounded-xl border border-brand-300/60 bg-brand-100/25 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AiMarker label="AI summary" />
            <span className="text-xs text-muted">Generated from this record — every claim below traces to data on the right.</span>
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

        {/* Latest measurements */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Latest measurements {latestVisit && `(${latestVisit.date})`}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              label="HbA1c"
              value={formatWithUnit("hba1c", latestVisit?.labs.hba1c)}
              paramKey="hba1c"
              points={engine.trends.hba1c?.points}
            />
            <StatTile
              label="Fasting glucose"
              value={formatWithUnit("fastingGlucose", latestVisit?.labs.fastingGlucose)}
              paramKey="fastingGlucose"
              points={engine.trends.fastingGlucose?.points}
            />
            <StatTile
              label="Weight"
              value={latestVisit?.vitals.weightKg ? `${latestVisit.vitals.weightKg.toFixed(1)} kg` : "—"}
              sub={derived.bmi ? `BMI ${derived.bmi.toFixed(1)}` : undefined}
              paramKey="weightKg"
              points={engine.trends.weightKg?.points}
            />
            <StatTile
              label="Blood pressure"
              value={latestVisit?.vitals.systolic ? `${latestVisit.vitals.systolic}/${latestVisit.vitals.diastolic}` : "—"}
              paramKey="systolic"
              points={engine.trends.systolic?.points}
            />
            <StatTile
              label="eGFR"
              value={derived.egfr ? `${derived.egfr.toFixed(0)}` : "—"}
              sub={derived.ckdStage}
              paramKey="egfr"
              points={engine.trends.egfr?.points}
            />
            <StatTile
              label="UACR"
              value={formatWithUnit("uacr", latestVisit?.labs.uacr)}
              sub={derived.albuminuriaStage}
              paramKey="uacr"
              points={engine.trends.uacr?.points}
            />
          </div>
        </div>

        {/* Demographics + status */}
        <div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Patient information</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Age / sex</dt>
                <dd className="text-ink">
                  {ageAt(patient.dob, new Date().toISOString().slice(0, 10))} · {patient.sex}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">MRN</dt>
                <dd className="text-ink">{patient.mrn}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Diabetes type</dt>
                <dd className="text-ink capitalize">{patient.diabetesType.replace("-", " ")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Diagnosed</dt>
                <dd className="text-ink">
                  {patient.diagnosisDate} ({derived.diabetesDurationYears.toFixed(1)} y)
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Smoking</dt>
                <dd className="text-ink capitalize">{patient.smoking}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Comorbidities</dt>
                <dd className="text-ink">
                  {patient.comorbidities.length > 0
                    ? patient.comorbidities.map((c) => COMORBIDITY_LABEL[c] ?? c).join(", ")
                    : "None recorded"}
                </dd>
              </div>
            </dl>

            <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">Current medications</h3>
            <p className="text-sm text-ink-secondary">
              {latestVisit && latestVisit.medications.length > 0
                ? latestVisit.medications.map((m) => `${m.name} ${m.dose}${m.unit} ${m.frequency}`).join(", ")
                : "None recorded"}
            </p>
          </div>
        </div>
      </div>

      {/* Right rail */}
      <aside className="space-y-5">
        {latestVisit && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-1 flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-brand-500" />
              <h3 className="text-sm font-semibold text-ink">Last updated</h3>
            </div>
            <p className="text-sm text-ink-secondary">{latestVisit.date}</p>
          </div>
        )}

        {recentReports.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-brand-500" />
                <h3 className="text-sm font-semibold text-ink">Recent lab reports</h3>
              </div>
              <a href="#labs" className="flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:underline">
                View all <ChevronRight className="h-3 w-3" />
              </a>
            </div>
            <ul className="space-y-2 text-sm text-ink-secondary">
              {recentReports.map((r) => (
                <li key={r.id} className="border-t border-gridline pt-2 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-ink">{r.date}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {r.fileName ?? "Manual entry"} · {r.values.length} values{r.acknowledged ? "" : ", pending review"}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.guidelines.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
  <h3 className="mb-1 text-sm font-semibold text-ink">
    Relevant reference information
  </h3>

  <p className="mb-2 text-xs text-muted">
    General guideline statements related to the values shown — not a personalised recommendation for this patient.
  </p>

  <div className="space-y-2 lg:max-h-[500px] lg:overflow-y-auto lg:pr-1">
    {summary.guidelines.map((g) => (
      <GuidelineCitation key={g.id} guideline={g} />
    ))}
  </div>
</div>
        )}
      </aside>
    </div>
  );
}
