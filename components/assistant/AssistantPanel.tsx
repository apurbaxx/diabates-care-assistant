"use client";

import { useState } from "react";
import { BookOpen, Send, Sparkles, Stethoscope } from "lucide-react";
import type { AssistantAnswer, AssistantFact, EngineResult, GuidelineRef, Insight, Patient } from "@/lib/types";
import { composeAnswer, suggestedQuestions } from "@/lib/assistant/compose";
import { useEvidence } from "@/components/shared/EvidenceContext";
import { GuidelineCitation } from "@/components/shared/GuidelineCitation";

function factToInsight(fact: AssistantFact, title: string): Insight {
  return {
    id: fact.id,
    scope: "overview",
    kind: "observation",
    severity: "info",
    title,
    statement: fact.text,
    evidence: fact.evidence,
    guidelines: [],
    confidence: "observed",
    parameters: [],
    visitIds: [],
  };
}

function FactRow({ fact }: { fact: AssistantFact }) {
  const { openInsight } = useEvidence();
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
      <span className="text-sm text-ink">
        {fact.text}{" "}
        {fact.evidence.length > 0 && (
          <button
            onClick={() => openInsight(factToInsight(fact, "Patient-specific fact"))}
            className="ml-1 rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-500/20"
          >
            evidence
          </button>
        )}
      </span>
    </li>
  );
}

function GuidelineRow({ item }: { item: { id: string; text: string; guideline: GuidelineRef } }) {
  return (
    <li>
      <GuidelineCitation guideline={item.guideline} />
    </li>
  );
}

function AnswerBlock({ answer }: { answer: AssistantAnswer }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Assistant</span>
        {answer.narrativeSource === "llm" && (
          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
            Rephrased by model, citations verified
          </span>
        )}
      </div>

      {answer.narrative ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{answer.narrative}</p>
      ) : (
        <>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
              <Stethoscope className="h-3.5 w-3.5" /> This patient
            </div>
            {answer.patientFindings.length === 0 ? (
              <p className="text-sm text-muted">No patient-specific facts in the record answer this directly.</p>
            ) : (
              <ul className="space-y-1.5">
                {answer.patientFindings.map((f) => (
                  <FactRow key={f.id} fact={f} />
                ))}
              </ul>
            )}
          </div>

          {answer.guidelineContext.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
                <BookOpen className="h-3.5 w-3.5" /> Guideline context
              </div>
              <ul className="space-y-1.5">
                {answer.guidelineContext.map((g) => (
                  <GuidelineRow key={g.id} item={g} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="border-t border-gridline pt-2 text-xs text-muted">{answer.caveats[answer.caveats.length - 1]}</p>
    </div>
  );
}

export function AssistantPanel({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AssistantAnswer[]>([]);
  const [loading, setLoading] = useState(false);
  const suggestions = suggestedQuestions(engine);

  async function ask(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setQuestion("");
    const deterministic = composeAnswer(patient, engine, q);
    setHistory((h) => [deterministic, ...h]);

    try {
      const resp = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: deterministic }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.narrative) {
          setHistory((h) => [
            { ...deterministic, narrative: data.narrative, narrativeSource: "llm" },
            ...h.slice(1),
          ]);
        }
      }
    } catch {
      // Silently keep the deterministic answer — the app is fully functional without the LLM pass.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Ask about {patient.name}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What has changed over the last 6 months?"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-secondary hover:bg-brand-100/40"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {loading && <div className="text-sm text-muted">Thinking…</div>}
        {history.map((a, i) => (
          <div key={i} className="space-y-1.5">
            <div className="text-sm font-medium text-ink-secondary">You asked: “{a.question}”</div>
            <AnswerBlock answer={a} />
          </div>
        ))}
        {history.length === 0 && !loading && (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            Ask a question above, or pick a suggestion. Answers separate what's in this patient's record from
            general guideline context, and every patient-specific claim links to its evidence.
          </p>
        )}
      </div>
    </div>
  );
}
