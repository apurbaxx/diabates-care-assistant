export type Slide = {
  section: string; title: string; copy: string;
  kind: "cover" | "chart" | "journey" | "workspace" | "ehr" | "knowledge" | "architecture" | "metrics" | "safety" | "sprint" | "cost" | "team";
  rows?: [string, string][]; note?: string; demo?: string;
};

export const slides: Slide[] = [
  { kind: "cover", section: "Health-a-thon 2026  /  Grand Finale", title: "ClinIQ", copy: "A doctor productivity and knowledge assistant for longitudinal diabetes care.", note: "IIT Bombay   /   Team KJI1F1" },
  { kind: "chart", section: "The problem", title: "Nearly half of office time goes to EHR and desk work.", copy: "In a US observational study, physicians spent 49.2% of office time on EHR and desk work. Direct patient care accounted for 27.0%.", rows: [["EHR & desk work","49.2"],["Direct patient time","27.0"],["Other activities","23.8"]], note: "Office time observed across 57 US physicians. Sinsky et al., Ann Intern Med (2016)." },
  { kind: "journey", section: "Outpatient diabetes care", title: "One visit, from review to follow-up.", copy: "For diabetologists, endocrinologists and outpatient teams in clinics and hospital departments.", rows: [["Review","Compare HbA1c, eGFR, UACR and medications across visits."],["Retrive","Quickly find past lab results, prescriptions and visit records."],["Document","Review the visit summary and record key changes."],["Follow up","Check appointments, refill reminders and pending tasks."]] },
  { kind: "workspace", section: "Live workflow   /   Patient review", title: "Read the record across visits.", copy: "Choose a patient from the worklist. Follow their timeline, compare lab results, then ask a question grounded in their record or upload a report for review.", demo: "/" },
  {
    kind: "ehr",
    section: "EHR Integration / Interoperability",
    title: "Built to work with existing EHR systems.",
    copy: "ClinIQ connects to OpenMRS through FHIR R4, bringing supported patient records into its existing workspace without modifying the original EHR data.",
    note: "Demonstrated with synthetic OpenMRS records, establishing a foundation for future integration with other FHIR-compatible hospital EHR systems.",
  },
  { kind: "knowledge", section: "Live workflow   /   Knowledge Assistant", title: "Clinical literature, made searchable.", copy: "Search clinical reference documents, find relevant passages and access the original source without manually browsing lengthy PDFs.", demo: "/knowledge-assistant", rows: [["9","Research PDFs"],["2,032","Indexed passages"]] },
  { kind: "architecture", section: "Inside ClinIQ", title: "The question determines the engine.", copy: "Patient comparisons use deterministic rules. Clinical reference searches use hybrid search over published passages.", note: "Next.js   /   Python & FastAPI   /   pypdf   /   Supabase PostgreSQL + pgvector" },
  { kind: "metrics", section: "MVP evaluation", title: "How well did the passages match?", copy: "Eight physicians tested predefined tasks across ten de-identified diabetes cases, including routine and complex scenarios.", rows: [["92%","Relevant answers"],["88%","Correct passage linking"],["2.3 s","Mean passage query time"]], note: "Team-reported MVP evaluation. The small group and limited guideline corpus constrain how broadly these results apply." },
  { kind: "safety", section: "", title: "The clinician makes the decision.", copy: "ClinIQ simplifies access to patient records, documentation and reference materials without interpreting medical data or recommending treatments.", rows: [["01","Uses synthetic patient records for prototype demonstration."],["02","Keeps patient information traceable and visit summaries editable."],["03","Does not diagnose, assess clinical risk or recommend treatments."]] },
  { kind: "sprint", section: "Build sprint", title: "From record viewer to clinical workspace.", copy: "Clinician feedback informed shorter visit summaries, direct source links, structured answers and clinical filters.", rows: [["Week 1","Frame the workflow and create synthetic records."],["Week 2","Build the directory, dashboard and longitudinal views."],["Week 3","Implement deterministic analysis and hybrid guideline retrieval."],["Week 4","Complete lab upload, comparisons, summaries and worklists."]] },
  {
    kind: "cost", section: "Deployment plan", title: "A single-site hospital pilot in India.",
    copy: "ClinIQ runs open-source ML models with zero recurring LLM API costs. The pilot budget covers hosting and the work of connecting to the hospital’s EHR.",
    rows: [["Prototype hosting","₹3,000–5,000"],["Single-site pilot infrastructure","₹15,000–25,000"],["EHR integration and setup","₹75,000–1,50,000"]],
    note: "Indicative estimates for a limited hospital pilot. Actual costs depend on infrastructure, security requirements and EHR compatibility."
  },
  { kind: "team", section: "Team ClinIQ   /   VIT Bhopal", title: "Thank you.", copy: "Health-a-thon 2026 Grand Finale · IIT Bombay · KJI1F1", rows: [["Apurba Das","Technical lead & full-stack development"],["Prakriti Wadhwani","AI retrieval & UI/UX"],["Neeraj Yadav","UI/UX development & testing"],["Aparna Baghel","UI/UX development"],["Dr Meeta Amit Burande","Clinical advisor · Diabetology & diabetes management"]], note: "apurbadas.work@gmail.com" }
];
