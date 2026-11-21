import type { CSSProperties } from "react";
import type { Slide } from "./deck";

export function Scene({ slide, enter }: { slide: Slide; enter: () => void }) {
  return <article className={'scene scene-' + slide.kind}>
    <small>{slide.section}</small>
    <h1>{slide.title}</h1>
    <p className="lead">{slide.copy}</p>
    {slide.kind === "cover" && <svg className="signal" viewBox="0 0 600 200" aria-hidden="true"><path pathLength="1" d="M0 115H170Q182 115 189 102L197 86 208 125 223 22 242 179 256 109 271 115H319Q332 115 342 94Q354 75 370 104Q378 115 393 115H600"/></svg>}
    {slide.kind === "chart" ? <div className="evidence"><div>{slide.rows?.map(([label,value])=><div className="bar" key={label}><span>{label}</span><strong>{value}%</strong><i style={{width:value+"%"}}/></div>)}</div><aside><b>16m 14s</b>Mean EHR time per outpatient encounter. US EHR log study of approximately 155,000 physicians.<a href="https://pubmed.ncbi.nlm.nih.gov/31931523/" target="_blank" rel="noreferrer">Overhage & McCallie, 2020 ↗</a></aside></div> :
      <div className="entries">{slide.rows?.map(([a,b],i)=><div key={a} style={{"--order":i} as CSSProperties}><strong>{a}</strong><span>{b}</span></div>)}</div>}
    {slide.demo && <button className="enter" onClick={enter}>Enter live demo <span>↗</span></button>}
    {slide.note && <p className="note">{slide.note} {slide.kind==="chart" && <a href="https://pubmed.ncbi.nlm.nih.gov/27599430/" target="_blank" rel="noreferrer">Study ↗</a>}</p>}
  </article>;
}
