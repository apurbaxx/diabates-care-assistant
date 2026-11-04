"use client";

import { ClinIQLogo } from "@/components/shared/ClinIQLogo";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import styles from "./WelcomeExperience.module.css";

const STORAGE_KEY = "cliniq:welcome:v1";
const WelcomeCompleteContext = createContext(false);
export function useWelcomeComplete() { return useContext(WelcomeCompleteContext); }

export function WelcomeExperience({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  const [checked,setChecked]=useState(false);
  const [visible,setVisible]=useState(false);
  const [phase,setPhase]=useState<"hello"|"transition"|"welcome">("hello");
  const [showDemo,setShowDemo]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      setVisible(saved?.completed!==true);
      // Retain prior completion without retaining previously collected personal information.
      if(saved?.completed===true)localStorage.setItem(STORAGE_KEY,JSON.stringify({completed:true,mode:"demo"}));
    } catch { setVisible(true); }
    setChecked(true);
  },[]);
  useEffect(()=>{
    if(!ready || !visible)return;
    const element=dialog.current;
    const previousFocus=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    element?.showModal();heading.current?.focus({preventScroll:true});
    if(element)element.scrollTop=0;
    return ()=>{element?.close();document.body.style.overflow=overflow;previousFocus?.focus({preventScroll:true});};
  },[ready,visible]);
  useEffect(()=>{
    if(!ready || !visible)return;
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hello=window.setTimeout(()=>setPhase("transition"),reduced ? 700 : 1400);
    const welcome=window.setTimeout(()=>setPhase("welcome"),reduced ? 700 : 1750);
    return ()=>{window.clearTimeout(hello);window.clearTimeout(welcome);};
  },[ready,visible]);
  useEffect(()=>{
    if(phase==="welcome" && visible){heading.current?.focus({preventScroll:true});if(dialog.current)dialog.current.scrollTop=0;}
  },[phase,visible]);
  const complete=ready && checked && !visible;
  useEffect(()=>{
    if(!complete)return;
    setShowDemo(true);
    const timer=window.setTimeout(()=>setShowDemo(false),5000);
    return ()=>window.clearTimeout(timer);
  },[complete]);
  const enterWorkspace=useCallback(()=>{
    try {localStorage.setItem(STORAGE_KEY,JSON.stringify({completed:true,mode:"demo"}));} catch { /* Entry also works without browser storage. */ }
    setVisible(false);
  },[]);
  useEffect(()=>{
    if(!ready || !visible || phase!=="welcome")return;
    const timer=window.setTimeout(enterWorkspace,10000);
    return ()=>window.clearTimeout(timer);
  },[ready,visible,phase,enterWorkspace]);
  return <WelcomeCompleteContext.Provider value={complete}>
    {complete && showDemo && <div className={styles.demoBar} role="note"><strong>Demo Mode</strong><span>Synthetic patient records. For demonstration.</span></div>}
    {children}
    {ready && visible && <dialog ref={dialog} className={styles.dialog} aria-labelledby="welcome-heading" aria-describedby={phase==="welcome" ? "welcome-description" : undefined} onCancel={event=>event.preventDefault()} onKeyDown={event=>{
      if(phase!=="welcome" || event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || ["Tab","Shift","Control","Alt","Meta"].includes(event.key))return;
      event.preventDefault();event.stopPropagation();enterWorkspace();
    }}>
      <div className={styles.shell}>
        <header className={styles.header}><ClinIQLogo size={32} /><span className={styles.eyebrow}>DEMO MODE</span></header>
        <div className={styles.rule}/>
        {phase!=="welcome" ? <main className={`${styles.greeting} ${phase==="transition" ? styles.greetingLeaving : ""}`}><h1 ref={heading} tabIndex={-1} id="welcome-heading" className={styles.headline}>Hello Doctor,</h1></main> : <main className={`${styles.introduction} ${styles.welcomeEntering}`}>
          <h1 ref={heading} tabIndex={-1} id="welcome-heading" className={styles.headline}>Welcome to <em>ClinIQ.</em></h1>
          <p id="welcome-description" className={styles.description}>Explore ClinIQ through a preconfigured demo workspace.<br/>All patient records are synthetic. This platform is intended for demonstration.</p>
          <div className={styles.overview} aria-label="Explore ClinIQ features">
            <article className={styles.feature}><span className={styles.number}>01</span><h2>Patient Records &amp; Assistant</h2><p>Explore longitudinal patient records, lab trends, medications, and source-grounded answers from patient data.</p></article>
            <article className={styles.feature}><span className={styles.number}>02</span><h2>Clinical Workflow Management</h2><p>Manage appointments, review pending reports, track tasks, and generate editable visit summaries.</p></article>
            <article className={styles.feature}><span className={styles.number}>03</span><h2>Evidence-Based Knowledge Assistant</h2><p>Retrieve relevant evidence from ADA and RSSDI diabetes guidelines with direct source references.</p></article>
          </div>
          <div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={enterWorkspace}>Explore ClinIQ <span aria-hidden="true">&rarr;</span></button><span>Press any key or select Explore ClinIQ.<br/>The workspace opens automatically after 10 seconds.</span></div>
        </main>}
        <footer className={styles.footer}><span>Patient records. Clinical workflows. Medical knowledge.</span><span>Demo workspace</span></footer>
      </div>
    </dialog>}
  </WelcomeCompleteContext.Provider>;
}
