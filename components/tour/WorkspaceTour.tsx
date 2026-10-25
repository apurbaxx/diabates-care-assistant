"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CircleCheck,
  Compass,
  FileText,
  Keyboard,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ───────────── Persistence (no patient data is stored) ───────────── */

const STORAGE_KEY = "cliniq:workspace-tour:v1";

export function hasSeenWorkspaceTour(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true; // storage blocked: never auto-open
  }
}

function markTourSeen(outcome: "completed" | "skipped") {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ outcome, at: new Date().toISOString() })
    );
  } catch {
    /* ignore */
  }
}

/* ───────────── Step definitions ───────────── */

type Placement = "top" | "bottom" | "left" | "right";

type TourStep = {
  id: string;
  /** value of the data-tour attribute on the real element; omit for centered steps */
  target?: string;
  title: string;
  description: string;
  icon: LucideIcon;
  art?: "welcome" | "done";
  placements?: Placement[];
};

const DEFAULT_PLACEMENTS: Placement[] = ["bottom", "top", "right", "left"];

const STEPS: TourStep[] = [
  {
    id: "welcome",
    icon: Compass,
    art: "welcome",
    title: "Take a tour of your workspace",
    description:
      "Welcome to ClinIQ. Take a quick tour to get familiar with your patient directory and clinical tools.",
  },
  {
    id: "directory",
    target: "patient-directory",
    icon: Users,
    title: "Your patient directory",
    description:
      "Find patients by name or MRN, use the available filters, and select View to open a patient’s record.",
    placements: ["right", "bottom", "top"],
  },
  {
    id: "record",
    target: "patient-record",
    icon: FileText,
    title: "Review patient records",
    description:
      "Open a patient’s record to review the available clinical information and documented history.",
    placements: ["right", "bottom", "top"],
  },
  {
    id: "knowledge",
    target: "knowledge-assistant",
    icon: BookOpen,
    title: "Your Knowledge Assistant",
    description:
      "Explore the Knowledge Assistant to ask clinical questions and find relevant medical information using the capabilities available in ClinIQ.",
    placements: ["bottom", "left", "top"],
  },
  {
    id: "schedule",
    target: "schedule",
    icon: CalendarDays,
    title: "Manage your daily schedule",
    description:
      "Review your appointments and use the available scheduling tools to manage upcoming visits.",
    placements: ["right", "bottom", "top"],
  },
  {
    id: "complete",
    icon: CircleCheck,
    art: "done",
    title: "You’re ready to get started",
    description:
      "You’ve completed the ClinIQ workspace tour. You can revisit your patients and clinical tools whenever you need them.",
  },
];

/* ───────────── Small flat illustration (inline SVG, no image file) ───────────── */

function TourArt({ done }: { done?: boolean }) {
  return (
    <svg className="tour-art" viewBox="0 0 232 84" aria-hidden="true" focusable="false">
      <path d="M34 28h8M38 24v8" stroke="#9ec0e8" strokeWidth="2" strokeLinecap="round" />
      <path d="M184 30h7M187.5 26.5v7" stroke="#9ec0e8" strokeWidth="2" strokeLinecap="round" />
      <circle cx="196" cy="62" r="3.5" fill="#c9d9ee" />
      <circle cx="62" cy="64" r="2.5" fill="#c9d9ee" />
      <rect x="84" y="14" width="64" height="62" rx="7" fill="#ffffff" stroke="#205ea6" strokeWidth="1.5" />
      <rect x="102" y="8" width="28" height="11" rx="3.5" fill="#205ea6" />
      <rect x="94" y="30" width="34" height="4" rx="2" fill="#c9d9ee" />
      <rect x="94" y="38" width="22" height="4" rx="2" fill="#dde8f5" />
      <polyline
        points="92,58 104,58 110,47 117,68 124,52 130,58 140,58"
        fill="none"
        stroke="#205ea6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {done ? (
        <>
          <circle cx="152" cy="26" r="14" fill="#205ea6" />
          <polyline
            points="145,26 150,31 159,20"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle cx="152" cy="24" r="10" fill="#205ea6" />
          <polyline
            points="147,24 151,28 158,19"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

/* ───────────── Geometry helpers ───────────── */

type Rect = { top: number; left: number; width: number; height: number };
type Size = { w: number; h: number };
type Position = {
  top: number;
  left: number;
  side: Placement | "center" | "dock";
  arrow?: number;
  stepId: string;
};

const PAD = 6; // spotlight padding around the target
const GAP = 14; // distance between spotlight and popover
const MARGIN = 12; // minimum distance from viewport edges

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

function findTarget(id: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function getAvailableSteps(): TourStep[] {
  return STEPS.filter((s) => !s.target || findTarget(s.target));
}

function scrollTargetIntoView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const tall = r.height > vh * 0.6;
  const outside = r.top < 80 || r.bottom > vh - 80;
  if (!tall && !outside) return;
  const top = tall ? r.top - 24 : r.top + r.height / 2 - vh / 2;
  window.scrollBy({ top, behavior: "auto" });
}

function computePosition(
  target: Rect | null,
  size: Size,
  preferred: Placement[]
): Omit<Position, "stepId"> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!target) {
    return {
      side: "center",
      top: Math.max(MARGIN, (vh - size.h) / 2),
      left: Math.max(MARGIN, (vw - size.w) / 2),
    };
  }

  // Centre of the part of the target that is actually visible
  const cx = (Math.max(target.left, 0) + Math.min(target.left + target.width, vw)) / 2;
  const cy = (Math.max(target.top, 0) + Math.min(target.top + target.height, vh)) / 2;

  for (const side of preferred) {
    if (side === "bottom") {
      const top = target.top + target.height + GAP;
      if (top + size.h <= vh - MARGIN) {
        const left = clamp(cx - size.w / 2, MARGIN, vw - size.w - MARGIN);
        return { side, top, left, arrow: clamp(cx - left, 18, size.w - 18) };
      }
    } else if (side === "top") {
      const top = target.top - size.h - GAP;
      if (top >= MARGIN) {
        const left = clamp(cx - size.w / 2, MARGIN, vw - size.w - MARGIN);
        return { side, top, left, arrow: clamp(cx - left, 18, size.w - 18) };
      }
    } else if (side === "right") {
      const left = target.left + target.width + GAP;
      if (left + size.w <= vw - MARGIN) {
        const top = clamp(cy - size.h / 2, MARGIN, vh - size.h - MARGIN);
        return { side, top, left, arrow: clamp(cy - top, 18, size.h - 18) };
      }
    } else {
      const left = target.left - size.w - GAP;
      if (left >= MARGIN) {
        const top = clamp(cy - size.h / 2, MARGIN, vh - size.h - MARGIN);
        return { side, top, left, arrow: clamp(cy - top, 18, size.h - 18) };
      }
    }
  }

  // Nothing fits (small screens / very tall targets): dock to the bottom of the viewport
  return {
    side: "dock",
    top: Math.max(MARGIN, vh - size.h - MARGIN),
    left: clamp((vw - size.w) / 2, MARGIN, vw - size.w - MARGIN),
  };
}

/* ───────────── Component ───────────── */

type Props = { open: boolean; onClose: () => void };

export function WorkspaceTour({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>(STEPS);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [animated, setAnimated] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const nudgedRef = useRef(false);

  const step = steps[index];

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset whenever the tour is opened
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setSteps(getAvailableSteps());
    setIndex(0);
    setRect(null);
    setPos(null);
    setAnimated(false);
  }, [open]);

  // Turn on glide transitions only after the first position has been painted
  useEffect(() => {
    if (!open || !pos || animated) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setAnimated(true));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [open, pos, animated]);

  const finish = useCallback(
    (outcome: "completed" | "skipped") => {
      markTourSeen(outcome);
      onClose();
      window.setTimeout(() => returnFocusRef.current?.focus?.(), 0);
    },
    [onClose]
  );

  // Re-check which targets exist on every move, so missing ones are skipped
  const move = useCallback(
    (delta: number) => {
      const fresh = getAvailableSteps();
      const at = Math.max(0, fresh.findIndex((s) => s.id === steps[index]?.id));
      const next = Math.min(Math.max(at + delta, 0), fresh.length - 1);
      setSteps(fresh);
      setIndex(next);
    },
    [steps, index]
  );

  // Jump straight to a step (progress dots)
  const goTo = useCallback(
    (k: number) => {
      const fresh = getAvailableSteps();
      const id = steps[k]?.id;
      const at = fresh.findIndex((s) => s.id === id);
      setSteps(fresh);
      setIndex(at >= 0 ? at : Math.min(k, fresh.length - 1));
    },
    [steps]
  );

  // Measure target + popover and compute positions
  const update = useCallback(() => {
    const current = steps[index];
    const pop = popoverRef.current;
    if (!current || !pop) return;
    const el = current.target ? findTarget(current.target) : null;
    const r = el?.getBoundingClientRect();
    const nextRect: Rect | null = r
      ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
      : null;
    const box = pop.getBoundingClientRect();
    setRect(nextRect);
    setPos({
      ...computePosition(nextRect, { w: box.width, h: box.height }, current.placements ?? DEFAULT_PLACEMENTS),
      stepId: current.id,
    });
  }, [steps, index]);

  // On each step: scroll the target into view if needed, then measure
  useLayoutEffect(() => {
    if (!open || !step) return;
    nudgedRef.current = false;
    if (step.target) {
      const el = findTarget(step.target);
      if (el) scrollTargetIntoView(el);
    }
    update();
  }, [open, step, update]);

  // Keep the spotlight in place on scroll / resize / target size change
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let instantTimer = 0;
    const root = rootRef.current;
    const schedule = () => {
      // follow the page instantly while scrolling/resizing (no gliding lag)
      root?.classList.add("tour-instant");
      window.clearTimeout(instantTimer);
      instantTimer = window.setTimeout(() => root?.classList.remove("tour-instant"), 160);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const el = step?.target ? findTarget(step.target) : null;
    const observer = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (el) observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(instantTimer);
      root?.classList.remove("tour-instant");
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      observer?.disconnect();
    };
  }, [open, step, update]);

  // Move focus into the popover on every step
  useEffect(() => {
    if (open && step) popoverRef.current?.focus({ preventScroll: true });
  }, [open, step]);

  // Keyboard: Esc = close, arrows = back/next, Tab stays inside the popover
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(index === steps.length - 1 ? "completed" : "skipped");
      } else if (e.key === "ArrowRight" && index < steps.length - 1) {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Tab") {
        const root = popoverRef.current;
        if (!root) return;
        const items = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!root.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (active === first || active === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, index, steps, finish, move]);

  // If the popover is docked and would cover the target, nudge the page once per step
  useEffect(() => {
    if (!open || !step || !pos || !rect) return;
    if (pos.side !== "dock" || pos.stepId !== step.id || nudgedRef.current) return;
    nudgedRef.current = true;
    const covered = rect.top + rect.height - (pos.top - MARGIN);
    const delta = Math.min(covered, rect.top - MARGIN);
    if (delta > 1) window.scrollBy({ top: delta, behavior: "auto" });
  }, [open, step, pos, rect]);

  if (!mounted || !open || !step) return null;

  const Icon = step.icon;
  const isWelcome = step.id === "welcome";
  const isLast = index === steps.length - 1;
  const spot: Rect = rect ?? {
    top: window.innerHeight / 2,
    left: window.innerWidth / 2,
    width: 0,
    height: 0,
  };
  const arrowStyle =
    !pos || pos.arrow === undefined
      ? undefined
      : pos.side === "top" || pos.side === "bottom"
        ? { left: pos.arrow - 6 }
        : pos.side === "left" || pos.side === "right"
          ? { top: pos.arrow - 6 }
          : undefined;

  return createPortal(
    <div ref={rootRef} className={`tour-root${animated ? " tour-animated" : ""}`}>
      <div
        className="tour-spotlight"
        data-active={rect ? "true" : "false"}
        style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        aria-hidden="true"
      >
        <span className="tour-ring" />
        <span className="tour-pulse" />
      </div>

      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-desc"
        tabIndex={-1}
        className="tour-popover"
        data-side={pos?.side ?? "center"}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      >
        {arrowStyle && <span className="tour-arrow" style={arrowStyle} aria-hidden="true" />}

        <div key={step.id} className="tour-fade">
          {step.art && <TourArt done={step.art === "done"} />}
          <div className="tour-body">
            <div className="tour-header">
              <span className="tour-chip" aria-hidden="true">
                <Icon size={17} />
              </span>
              <h2 id="tour-title" className="tour-title">{step.title}</h2>
              <button
                type="button"
                className="tour-close"
                aria-label={isLast ? "Close tour" : "Skip tour"}
                title={isLast ? "Close tour" : "Skip tour"}
                onClick={() => finish(isLast ? "completed" : "skipped")}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <p id="tour-desc" className="tour-desc">{step.description}</p>
            {isWelcome && (
              <p className="tour-hint">
                <Keyboard size={13} aria-hidden="true" /> Use ← → to move, Esc to close
              </p>
            )}
          </div>
        </div>

        <div className="tour-foot">
          {!isWelcome && (
            <div className="tour-dots" role="group" aria-label="Tour steps">
              {steps.map((s, k) => (
                <button
                  key={s.id}
                  type="button"
                  className={`tour-dot${k === index ? " on" : ""}`}
                  aria-label={`Go to step ${k + 1}: ${s.title}`}
                  aria-current={k === index ? "step" : undefined}
                  onClick={() => goTo(k)}
                />
              ))}
            </div>
          )}
          <div className="tour-actions">
            {isWelcome ? (
              <>
                <button type="button" className="tour-btn" onClick={() => finish("skipped")}>
                  Skip tour
                </button>
                <button type="button" className="tour-btn tour-btn-primary" onClick={() => move(1)}>
                  Start tour
                </button>
              </>
            ) : (
              <>
                <button type="button" className="tour-btn" onClick={() => move(-1)}>
                  <ArrowLeft size={14} aria-hidden="true" /> Back
                </button>
                <span className="tour-count" aria-live="polite">
                  {index + 1}/{steps.length}
                </span>
                <button
                  type="button"
                  className="tour-btn tour-btn-primary"
                  onClick={() => (isLast ? finish("completed") : move(1))}
                >
                  {isLast ? (
                    <>
                      <Check size={14} aria-hidden="true" /> Finish tour
                    </>
                  ) : (
                    <>
                      Next <ArrowRight size={14} aria-hidden="true" />
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}