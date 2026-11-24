import { useEffect, useState, type CSSProperties } from "react";
import { BookOpen, CalendarDays, ClipboardList, FileStack } from "lucide-react";
import type { Slide } from "./deck";
import { EngineDiagram } from "./EngineDiagram";
import { EvidenceChart } from "./EvidenceChart";

const journeyIcons = [FileStack, BookOpen, ClipboardList, CalendarDays];
function Count({value}:{value:string}) {
  const [display,setDisplay]=useState(value);
  useEffect(()=>{
    if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const number=parseFloat(value), decimals=value.includes(".")?1:0, suffix=value.replace(/^[\d.]+/,"");
    let frame=0;
    const start=performance.now();
    function tick(now:number){
      const progress=Math.min(1,(now-start)/750);
      setDisplay((number*(1-(1-progress)**3)).toFixed(decimals)+suffix);
      if(progress<1)frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[value]);
  return <span aria-label={value}>{display}</span>;
}
function EhrFlow() {
  return (
    <figure className="ehr-flow" aria-label="Patient records flow from OpenMRS to ClinIQ through FHIR R4">
      <ol className="ehr-flow-steps" role="list">
        <li>
          <span className="ehr-flow-arrow" aria-hidden="true" />
          <h2>OpenMRS</h2>
          <p>Original patient records</p>
        </li>
        <li>
          <span className="ehr-flow-arrow" aria-hidden="true" />
          <h2>FHIR R4</h2>
          <p>Authenticated, read-only data exchange</p>
        </li>
        <li>
          <h2>ClinIQ</h2>
          <p>Patient review, comparisons, patient assistant and documentation</p>
        </li>
      </ol>
      <ul className="ehr-capabilities" role="list" aria-label="Integration capabilities">
        <li>Read-only access</li>
        <li>Source traceability</li>
        <li>Reduced manual entry</li>
      </ul>
    </figure>
  );
}
function CoverArt(){
  return <div className="cover-art" aria-hidden="true"><div className="folio back">CARE CONTINUITY</div><div className="folio middle">Visit history</div><div className="folio front"><BookOpen/><span>Patient record</span><svg viewBox="0 0 300 80"><path pathLength="1" d="M0 48H65L75 40 84 51 97 13 108 68 119 43 130 48H164Q176 48 184 37Q194 24 204 41Q211 48 225 48H300"/></svg></div></div>;
}
function Evaluation({rows}:{rows:[string,string][]}){
  const [feedback,setFeedback]=useState(false);
  const values=feedback?[["88%","Found responses clinically useful"],["75%","Felt guideline lookup saved time"],["87%","Would use it in routine practice"]]:rows;
  return <section className="evaluation"><div className="engine-choices">{["Retrieval performance","Physician feedback"].map((t,i)=><button key={t} onClick={()=>setFeedback(!!i)} aria-pressed={feedback===!!i}>{t}</button>)}</div><div className="entries" aria-live="polite">{values.map(([v,l])=><div key={l}><strong><Count value={v}/></strong><span>{l}</span></div>)}</div></section>;
}
export function Scene({slide,enter,animateEhr}:{slide:Slide;enter:()=>void;animateEhr:boolean}){
  const {kind,rows=[]}=slide;
  const demoButton = <button className="enter" onClick={enter}>Enter live demo <span>↗</span></button>;
  return <article className={`scene scene-${kind}${kind === "ehr" && animateEhr ? " scene-ehr-first-visit" : ""}`}>
    <div className="scene-intro">{slide.section && <small>{slide.section}</small>}<h1>{slide.title}</h1><p className="lead">{slide.copy}</p>
      {slide.demo && kind==="knowledge" && demoButton}
    </div>
    {kind==="cover" && <CoverArt/>}
    {kind==="ehr" && <EhrFlow/>}
    {kind==="chart" && <><EvidenceChart rows={rows}/><p className="encounter"><b>16 min 14 sec</b> mean EHR time per outpatient encounter in a separate US study of approximately 155,000 physicians. <a href="https://pubmed.ncbi.nlm.nih.gov/31931523/" target="_blank" rel="noreferrer">Overhage & McCallie, 2020 ↗</a></p></>}
    {kind==="architecture" && <EngineDiagram/>}
    {kind==="metrics" && <Evaluation rows={rows}/>}
    {!["architecture","chart","metrics"].includes(kind) && rows.length>0 && <div className="entries">{rows.map(([label,detail],i)=>{
      const Icon=journeyIcons[i];
      return <div key={label} style={{"--order":i} as CSSProperties}>{kind==="journey" && <Icon aria-hidden="true"/>}<strong>{label}</strong><span>{detail}</span></div>;
    })}</div>}
    {slide.demo && kind!=="knowledge" && demoButton}
    {slide.note && <p className="note">{slide.note} {kind==="chart" && <a href="https://pubmed.ncbi.nlm.nih.gov/27599430/" target="_blank" rel="noreferrer">Read study ↗</a>}</p>}
  </article>;
}
