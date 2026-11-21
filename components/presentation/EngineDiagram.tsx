import { useState } from "react";
const paths = [
  {name:"Patient records", question:"What changed between visits?", steps:[["Input","Selected patient’s labs, vitals, visits and medications."],["Analysis","Deterministic comparisons and rule-based trend analysis."],["Output","Findings traceable to the patient’s own record."]]},
  {name:"Clinical guidelines", question:"Where is the supporting passage?", steps:[["Index","pypdf extracts passages from ADA and RSSDI documents."],["Retrieve","SentenceTransformers embeddings in pgvector plus BM25 lexical search."],["Rank & cite","A cross-encoder reranks results. Each passage carries its section and page."]]}
];
export function EngineDiagram(){
  const [active,setActive]=useState(0);
  const path=paths[active];
  return <section className="engine"><div className="engine-choices">{paths.map((p,i)=><button key={p.name} aria-pressed={active===i} onClick={()=>setActive(i)}>{p.name}</button>)}</div>
    <div key={active} aria-live="polite"><h2>{path.question}</h2><ol>{path.steps.map(([label,detail])=><li key={label}><strong>{label}</strong><p>{detail}</p></li>)}</ol></div>
  </section>;
}
