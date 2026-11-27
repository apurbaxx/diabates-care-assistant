import { useState } from "react";

const colors = ["var(--chart-records, #245adb)", "var(--chart-care, #348977)", "var(--chart-other, #8196ad)"];
export function EvidenceChart({rows}:{rows:[string,string][]}) {
  const [selected, select] = useState(0);
  const [label, share] = rows[selected];
  const minutes = Math.round(Number(share) * 4.8);
  return <div className="time-study">
    <section aria-label="Observed office time">
      <h2>Share of observed office time</h2>
      <div className="allocation" aria-hidden="true">{rows.map(([name,value],i)=><i key={name} style={{flex:Number(value),background:colors[i],opacity:selected===i?1:.65}}/>)}</div>
      {rows.map(([name,value],i)=><button className="time-row" key={name} aria-pressed={selected===i} onClick={()=>select(i)}>
        <i style={{background:colors[i]}}/>{name}<b>{value}%</b>
      </button>)}
    </section>
    <aside className="day-readout" aria-live="polite"><small>Illustrative eight-hour day</small><b>{Math.floor(minutes/60)}h {minutes%60}m</b><p>{label} at {share}% of eight hours, rounded to the nearest minute.</p></aside>
  </div>;
}
