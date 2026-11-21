"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, MonitorPlay, X } from "lucide-react";
import { ClinIQLogo } from "@/components/shared/ClinIQLogo";
import { slides } from "./deck";
import { Scene } from "./Scene";
import "./presentation.css";
import "./scenes.css";

const Launch = createContext<(() => void) | null>(null);
export function PresentationButton() {
  const launch = useContext(Launch);
  return launch && <button onClick={launch}><MonitorPlay size={16} aria-hidden="true"/> Presentation Mode</button>;
}

type Position = {index:number; live:boolean};
const sessionKey = "cliniq:presentation:v1";
export function Presentation({children}:{children:React.ReactNode}) {
  const router = useRouter();
  const [position,setPosition] = useState<Position|null>(null);
  const [ready,setReady] = useState(false);
  const [alt,setAlt] = useState(false);
  const deck = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement|null>(null);
  const index = position?.index ?? 0;
  const slide = slides[index];
  const live = !!position?.live;
  const preview = !!position && !live && slide.kind === "workspace";
  const active = !!position;
  useEffect(()=>{
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
      if(saved && Number.isInteger(saved.index) && slides[saved.index])
        setPosition({index:saved.index,live:!!slides[saved.index].demo && saved.live===true});
      setAlt(localStorage.getItem(sessionKey+":alt")==="true");
    } catch {}
    setReady(true);
  },[]);
  useEffect(()=>{
    if(!ready)return;
    try { sessionStorage.setItem(sessionKey, JSON.stringify(position)); localStorage.setItem(sessionKey+":alt",String(alt)); } catch {}
  },[position,alt,ready]);
  useLayoutEffect(()=>{
    const el=deck.current;
    if(!el || !active || live)return;
    if(preview)el.show(); else el.showModal();
    el.focus({preventScroll:true});
    return ()=>el.close();
  },[active,live,preview]);
  function exit() {setPosition(null);requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));}
  function go(to:number) {
    if(to>=slides.length){exit();return;}
    if(slides[to]?.kind==="workspace" && location.pathname==="/knowledge-assistant")router.push("/");
    setPosition({index:Math.max(0,to),live:false});
  }
  function enter(){
    if(!slide.demo)return;
    if(slide.kind==="knowledge" && location.pathname!==slide.demo)router.push(slide.demo);
    setPosition({index,live:true});
  }
  function next(){if(!live && slide.demo)enter();else go(index+1);}
  useEffect(()=>{
    if(!position)return;
    function handle(e:KeyboardEvent){
      if(e.isComposing || e.repeat)return;
      const direction=e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0;
      if(live){
        if(!direction || !e.shiftKey || e.metaKey || (alt ? !e.altKey || e.ctrlKey : !e.ctrlKey || e.altKey))return;
        go(index+direction);
      }else{
        const target=e.target as HTMLElement;
        if(e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||target.closest('input, textarea, select, [contenteditable=true]') || (preview && target.closest('.keynote-app')))return;
        if(e.key==="Escape")exit();
        else if(direction===-1)go(index-1);
        else if((e.key===" " || e.key==="Enter") && target.closest("button,a"))return;
        else if(direction===1 || e.key===" ")next();
        else if(e.key==="Enter" && slide.demo)enter();
        else return;
      }
      e.preventDefault();e.stopImmediatePropagation();
    }
    window.addEventListener("keydown",handle,true);
    return ()=>window.removeEventListener("keydown",handle,true);
  });
  return <Launch.Provider value={active?null:()=>{trigger.current=document.activeElement as HTMLElement;setPosition({index:0,live:false});}}>
    <div className={'keynote-app '+(active?'staged ':'')+(preview?'preview':'')} inert={active && !live && !preview}>{children}</div>
    {active && !live && <dialog ref={deck} tabIndex={-1} aria-label="ClinIQ presentation" className={'keynote '+(preview?'split':'')} onCancel={e=>{e.preventDefault();exit();}}>
      <header><ClinIQLogo/><span>Health-a-thon 2026</span><button onClick={exit} aria-label="Exit presentation"><X size={18}/></button></header>
      <Scene key={index} slide={slide} enter={enter}/>
      <footer><span>{String(index+1).padStart(2,"0")} / {slides.length}</span><progress value={index+1} max={slides.length}/><label>Demo keys <select aria-label="Demo shortcut modifiers" value={alt?"alt":"ctrl"} onChange={e=>setAlt(e.target.value==="alt")}><option value="ctrl">Ctrl ⇧ ←/→</option><option value="alt">Alt ⇧ ←/→</option></select></label><button disabled={!index} aria-label="Previous slide" onClick={()=>go(index-1)}><ChevronLeft/></button><button aria-label={index===slides.length-1?"Finish presentation":"Advance presentation"} onClick={next}><ChevronRight/></button></footer>
    </dialog>}
    {live && <nav className="demo-nav" aria-label="Live demonstration"><span>Live demo</span><button onClick={()=>go(index-1)} aria-label="Previous slide"><ChevronLeft size={16}/></button><button onClick={()=>go(index+1)}>Continue <kbd>{alt?"Alt":"Ctrl"} ⇧ →</kbd></button><button aria-label="Exit presentation" onClick={exit}><X size={15}/></button></nav>}
  </Launch.Provider>;
}
