"use client";

import { useMemo, useState } from "react";
import type { Patient } from "@/lib/types";
import { compareVisits } from "@/lib/clinical/analyzers/comparison";
import { buildSeries } from "@/lib/clinical/context";
import { sortedVisits } from "@/lib/clinical/derive";
import { parameterMeta } from "@/lib/clinical/units";

function signedValue(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(decimals)}`;
}

export function VisitComparison({ patient, initialCurrentId = "", initialPreviousId = "" }: { patient: Patient; initialCurrentId?: string; initialPreviousId?: string }) {
  const visits = useMemo(() => sortedVisits(patient), [patient]);
  const [currentId, setCurrentId] = useState(initialCurrentId);
  const [previousId, setPreviousId] = useState(initialPreviousId);
  const currentVisit = visits.find(v => v.id === currentId) ?? visits.at(-1);
  const earlierVisits = visits.filter(v => currentVisit && v.date < currentVisit.date);
  const previousVisit = earlierVisits.find(v => v.id === previousId) ?? earlierVisits.at(-1);
  const { rows } = useMemo(() => compareVisits({
    ...patient,
    visits: [...(previousVisit ? [previousVisit] : []), ...(currentVisit ? [currentVisit] : [])],
  }), [patient, currentVisit, previousVisit]);
  const history = useMemo(() => buildSeries(visits.filter(v => currentVisit && v.date <= currentVisit.date)), [visits, currentVisit]);

  if (!currentVisit) return <p className="record-empty">No visits recorded for this patient yet.</p>;

  const pairedRows = rows.filter(r => r.current !== undefined && r.previous !== undefined);
  const firstDate = visits[0].date;
  const historyDates = new Set(rows.flatMap(r => (history[r.key] ?? []).map(p => p.date)));
  const years = (Date.parse(currentVisit.date) - Date.parse(firstDate)) / (365.25 * 86400000);

  return (
    <div className="visit-comparison">
      <div className="visit-comparison-dates">
        <label>
          <span>{currentVisit.id === visits.at(-1)?.id ? "Most recent visit" : "Selected visit"}</span>
          <select aria-label="Current comparison visit" value={currentVisit.id} onChange={event => { setCurrentId(event.target.value); setPreviousId(""); }}>
            {[...visits].reverse().map(visit => <option key={visit.id} value={visit.id}>{visit.date}</option>)}
          </select>
        </label>
        <span className="visit-comparison-versus">vs</span>
        <label>
          <span>Previous visit</span>
          <select aria-label="Previous comparison visit" value={previousVisit?.id ?? ""} disabled={!earlierVisits.length} onChange={event => setPreviousId(event.target.value)}>
            {!earlierVisits.length && <option value="">No prior visit</option>}
            {[...earlierVisits].reverse().map(visit => <option key={visit.id} value={visit.id}>{visit.date}</option>)}
          </select>
        </label>
      </div>

      <div className="visit-comparison-summary" aria-live="polite">
        <h3>{pairedRows.length} of {rows.length} measurements available in both visits</h3>
        <p>{!previousVisit ? "No earlier visit is recorded. Current results are shown below." : "Change is the selected visit’s result minus the previous visit’s result."}</p>
      </div>

      {rows.length === 0 ? <p className="record-empty">No laboratory measurements recorded for these visits.</p> : (
        <>
          <div className="visit-comparison-scroll" role="region" aria-label="Visit measurement comparison" tabIndex={0}>
            <table className="visit-comparison-table">
              <caption className="sr-only">Laboratory results for {currentVisit.date}{previousVisit ? ` compared with ${previousVisit.date}` : ""}, with change since the first recorded reading.</caption>
              <thead><tr>
                <th scope="col">Parameter</th>
                <th scope="col">{previousVisit?.date ?? "—"}<span>previous</span></th>
                <th scope="col">{currentVisit.date}<span>current</span></th>
                <th scope="col">Change</th>
                <th scope="col">First reading {firstDate} → current</th>
              </tr></thead>
              <tbody>{rows.map(row => {
                const decimals = parameterMeta(row.key).decimals;
                const first = history[row.key]?.[0];
                const totalChange = first && row.current !== undefined ? row.current - first.value : undefined;
                return <tr key={row.key}>
                  <th scope="row">{row.label} <span className="visit-comparison-unit">{row.unit}</span></th>
                  <td className="visit-comparison-previous">{row.previous?.toFixed(decimals) ?? "—"}</td>
                  <td className="visit-comparison-current">{row.current?.toFixed(decimals) ?? "—"}</td>
                  <td className="visit-comparison-change">{row.delta !== undefined ? signedValue(row.delta, decimals) : "—"}</td>
                  <td className="visit-comparison-history">
                    {first && row.current !== undefined ? <>
                      <span>{first.value.toFixed(decimals)} → {row.current.toFixed(decimals)}</span>{" "}
                      <strong>({signedValue(totalChange!, decimals)})</strong>
                      {first.date !== firstDate && <small>First recorded {first.date}</small>}
                    </> : "—"}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <p className="visit-comparison-footnote">History covers {historyDates.size} recorded measurement date{historyDates.size === 1 ? "" : "s"} over {years.toFixed(1)} years. Change in brackets is current minus first reading. Missing results are shown as —.</p>
        </>
      )}
    </div>
  );
}
