"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, CalendarDays, FileText } from "lucide-react";
import styles from "./WelcomeExperience.module.css";

const STORAGE_KEY = "cliniq:welcome:v1";
const WelcomeCompleteContext = createContext(false);

export function useWelcomeComplete() {
  return useContext(WelcomeCompleteContext);
}

function cleanName(value: string) {
  return value.trim().replace(/^dr\.?(?:\s+|$)/i, "").replace(/\s+/g, " ");
}

export function WelcomeExperience({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<"name" | "greeting">("name");
  const [name, setName] = useState("");
  const [leaving, setLeaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const greeting = useRef<HTMLHeadingElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      setVisible(!(saved?.completed === true && typeof saved?.name === "string" && saved.name.trim()));
    } catch {
      setVisible(true);
    }
    setChecked(true);
    return () => clearTimeout(exitTimer.current);
  }, []);

  useEffect(() => {
    if (!ready || !visible) return;
    const element = dialog.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    input.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [ready, visible]);

  useEffect(() => {
    if (step === "greeting") greeting.current?.focus({ preventScroll: true });
  }, [step]);

  function enterWorkspace() {
    if (leaving) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: cleanName(name), completed: true }));
    } catch {
      // Completion still works for this session when browser storage is unavailable.
    }
    setLeaving(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350;
    exitTimer.current = setTimeout(() => setVisible(false), delay);
  }

  return <WelcomeCompleteContext.Provider value={ready && checked && !visible}>
    {children}
    {ready && visible && <dialog ref={dialog} className={`${styles.dialog} ${leaving ? styles.leaving : ""}`} aria-labelledby="welcome-heading" aria-describedby="welcome-description" onCancel={event => event.preventDefault()}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Clin<span>IQ</span><span className={styles.brandDot} aria-hidden="true" /></span>
        <span className={styles.eyebrow}>A little clarity, before you begin</span>
      </header>
      <div className={styles.rule} aria-hidden="true"><span /></div>

      {step === "name" ? <div key="name" className={styles.nameStep}>
        <p className={styles.eyebrow}><span className={styles.stepNumber}>01 /</span> Your workspace, made personal</p>
        <h1 id="welcome-heading" className={styles.headline}>A clearer view.<br /><em>A more focused day.</em></h1>
        <p id="welcome-description" className={styles.description}>Welcome to ClinIQ. A little more context for every patient.<br className={styles.desktopBreak} /> A little more space for the work that matters.</p>

        <form className={styles.form} onSubmit={event => { event.preventDefault(); const value = cleanName(name); if (value) { setName(value); setStep("greeting"); } }}>
          <label htmlFor="welcome-name" className={styles.nameLabel}>Let’s begin with your name.</label>
          <div className={styles.nameLine}>
            <span className={styles.prefix} aria-hidden="true">Dr.</span>
            <input ref={input} id="welcome-name" name="doctor-name" autoComplete="given-name" aria-label="Your name, prefixed with Dr." value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="Your name" required />
            <button type="submit" className={styles.arrowButton} disabled={!cleanName(name)} aria-label="Continue to your welcome"><ArrowRight size={24} strokeWidth={1.5} /></button>
          </div>
          <div className={styles.inputFooter}><span>Just for your welcome. Saved only in this browser.</span><span className={styles.enterHint}>Press Enter <span aria-hidden="true">↵</span></span></div>
        </form>
      </div> : <div key="greeting" className={styles.greetingStep}>
        <p className={styles.eyebrow}><span className={styles.stepNumber}>02 /</span> A place for your day</p>
        <h1 ref={greeting} tabIndex={-1} id="welcome-heading" className={styles.greeting}>Hello, <em>Dr. {name}.</em></h1>
        <p id="welcome-description" className={styles.description}>Your patients’ stories, a little clearer.<br />Your working day, a little more connected.</p>
        <div className={styles.overview} aria-label="Your ClinIQ workspace at a glance">
          <article className={styles.feature}><div className={styles.featureTop}><span>01</span><FileText size={19} strokeWidth={1.4} /></div><h2>The whole patient story.</h2><p>Review visits, lab results, medications and trends. Ask the AI Assistant questions grounded in the patient’s record.</p></article>
          <article className={styles.feature}><div className={styles.featureTop}><span>02</span><CalendarDays size={19} strokeWidth={1.4} /></div><h2>A more connected day.</h2><p>Keep appointments, reports awaiting review and visit summaries together in one considered workspace.</p></article>
          <article className={styles.feature}><div className={styles.featureTop}><span>03</span><BookOpen size={19} strokeWidth={1.4} /></div><h2>Room to explore.</h2><p>Search diabetes research with Knowledge Explorer and follow sources for further reading.</p></article>
        </div>
        <div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={enterWorkspace} disabled={leaving}>Enter workspace <ArrowRight size={18} strokeWidth={1.5} /></button><span>You can explore more with “Take a tour” anytime.</span></div>
      </div>}

      <footer className={styles.footer}><span>Thoughtfully organised. Clinician led.</span><span className={styles.footerRight}>Your judgment stays at the centre.</span></footer>
    </div>
  </dialog>}
  </WelcomeCompleteContext.Provider>;
}
