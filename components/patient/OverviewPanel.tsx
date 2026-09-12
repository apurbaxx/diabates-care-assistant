import { Sparkles } from "lucide-react";
import type { EngineResult, Patient } from "@/lib/types";
import { ageAt } from "@/lib/clinical/derive";
import { formatWithUnit } from "@/lib/clinical/units";
import { InsightList } from "@/components/shared/InsightCard";
import { insightsForScope } from "@/lib/clinical/engine";
import { AiMarker } from "@/components/shared/Badges";
import { GuidelineCitation } from "@/components/shared/GuidelineCitation";

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

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-secondary">{sub}</div>}
    </div>
  );
}

export function OverviewPanel({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const { derived, summary } = engine;
  const latestVisit = derived.latestVisit;
  const overviewInsights = insightsForScope(engine.insights, "overview");

  return (
    <div className="space-y-5">
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

      {/* Demographics + status */}
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Patient information</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
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

        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Individualised targets</h3>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-muted">HbA1c goal</div>
              <div className="font-semibold text-brand-700">{derived.hba1cTarget.value}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Blood pressure goal</div>
              <div className="font-semibold text-brand-700">{derived.bpTarget.value}</div>
            </div>
            <div>
              <div className="text-xs text-muted">LDL-C goal</div>
              <div className="font-semibold text-brand-700">{derived.ldlTarget.value}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Latest measurements */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Latest measurements {latestVisit && `(${latestVisit.date})`}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatTile label="HbA1c" value={formatWithUnit("hba1c", latestVisit?.labs.hba1c)} />
          <StatTile label="Fasting glucose" value={formatWithUnit("fastingGlucose", latestVisit?.labs.fastingGlucose)} />
          <StatTile label="Weight" value={latestVisit?.vitals.weightKg ? `${latestVisit.vitals.weightKg.toFixed(1)} kg` : "—"} sub={derived.bmi ? `BMI ${derived.bmi.toFixed(1)}` : undefined} />
          <StatTile
            label="Blood pressure"
            value={latestVisit?.vitals.systolic ? `${latestVisit.vitals.systolic}/${latestVisit.vitals.diastolic}` : "—"}
          />
          <StatTile label="eGFR" value={derived.egfr ? `${derived.egfr.toFixed(0)}` : "—"} sub={derived.ckdStage} />
          <StatTile label="UACR" value={formatWithUnit("uacr", latestVisit?.labs.uacr)} sub={derived.albuminuriaStage} />
        </div>
      </div>

      {/* Recent reports */}
      {patient.labReports.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Recent lab reports</h3>
          <ul className="space-y-1 text-sm text-ink-secondary">
            {[...patient.labReports]
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 4)
              .map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="tabular-nums">{r.date}</span>
                  <span>·</span>
                  <span>{r.fileName ?? "Manual entry"}</span>
                  <span className="text-xs text-muted">({r.values.length} values{r.acknowledged ? "" : ", pending review"})</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Overview-level AI insights */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-ink">AI insights — overview</h3>
        </div>
        <InsightList insights={overviewInsights} />
      </div>

      {summary.guidelines.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Guideline basis for this summary</h3>
          <div className="space-y-2">
            {summary.guidelines.map((g) => (
              <GuidelineCitation key={g.id} guideline={g} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
