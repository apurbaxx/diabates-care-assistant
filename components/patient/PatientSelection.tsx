"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PlusCircle,
  Search,
  Users,
  Droplets,
  Activity,
  ArrowUpDown,
  ChevronDown,
  MoreHorizontal,
  CalendarDays,
  ArrowRight,
  SlidersHorizontal,
} from "lucide-react";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { ageAt, sortedVisits } from "@/lib/clinical/derive";
import { GeneratePatientDialog } from "./GeneratePatientDialog";
import { SafetyFooter } from "@/components/shared/SafetyFooter";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { CkdStage, DiabetesType } from "@/lib/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_PALETTES = [
  { bg: "#e8e0f7", text: "#7c5cc4" },
  { bg: "#fde8e8", text: "#c45c5c" },
  { bg: "#e8f2fd", text: "#3a7bc8" },
  { bg: "#e8f7ee", text: "#3a9e65" },
  { bg: "#fdf5e8", text: "#c49a3a" },
  { bg: "#f7e8f5", text: "#a03a9e" },
];

function avatarPalette(name: string) {
  const idx = name.charCodeAt(0) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[idx];
}

function diabetesTypeLabel(dt: DiabetesType): string {
  switch (dt) {
    case "type-1": return "Type 1";
    case "type-2": return "Type 2";
    case "gestational": return "Gestational";
    case "mody": return "MODY";
    case "secondary": return "Secondary";
  }
}

// Single uniform clinical color for all HbA1c values — same muted indigo used for Ahmed Hassan
const HBA1C_COLOR = "#5c4f8a";
function hba1cColor(_v: number): string {
  return HBA1C_COLOR;
}

function ckdStageBadgeStyle(stage: CkdStage): { bg: string; text: string } {
  // Uniform cool slate tones — differentiated by lightness, not traffic-light hues
  switch (stage) {
    case "G1": return { bg: "#eef2f7", text: "#3d5a80" };
    case "G2": return { bg: "#e6ecf5", text: "#2d4d72" };
    case "G3a": return { bg: "#dde6f0", text: "#244063" };
    case "G3b": return { bg: "#d4dcea", text: "#1c3455" };
    case "G4": return { bg: "#c8d3e2", text: "#152846" };
    case "G5": return { bg: "#bcc9da", text: "#0e1f38" };
  }
}

// ─── Mini Sparkline ─────────────────────────────────────────────────────────

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const pts = data.map((v) => ({ v }));
  return (
    <div style={{ width: 56, height: 28, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Filter Dropdown ─────────────────────────────────────────────────────────

function FilterDropdown({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none flex items-center gap-2 rounded-md border border-[#e2e8f0] bg-white pl-9 pr-8 py-2.5 text-sm text-[#374151] font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-200 hover:border-blue-300 transition-colors"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {icon && (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]">
          {icon}
        </div>
      )}
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9ca3af]" />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PatientSelection() {
  const router = useRouter();
  const patients = useAppStore((s) => s.patients);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const [query, setQuery] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [diabetesFilter, setDiabetesFilter] = useState("all");
  const [kidneyFilter, setKidneyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("hba1c");

  useEffect(() => {
    if (hasHydrated) ensureSeeded();
  }, [hasHydrated]);

  const rows = useMemo(() => {
    return patients.map((p) => {
      const engine = runEngine(p);
      const visits = sortedVisits(p);
      const hba1cSeries = visits
        .map((v) => v.labs.hba1c)
        .filter((v): v is number => v !== undefined);
      const latestVisit = engine.derived.latestVisit;
      return { patient: p, engine, hba1cSeries, latestVisit };
    });
  }, [patients]);

  // Compute summary stats from actual data
  const totalPatients = rows.length;
  const type2Count = rows.filter((r) => r.patient.diabetesType === "type-2").length;

  // Filtered + sorted
  const filtered = useMemo(() => {
    let list = rows.filter(({ patient }) => {
      const q = query.toLowerCase().trim();
      if (q) {
        const match =
          patient.name.toLowerCase().includes(q) ||
          patient.mrn.toLowerCase().includes(q) ||
          patient.diabetesType.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (diabetesFilter !== "all" && patient.diabetesType !== diabetesFilter) return false;
      if (kidneyFilter !== "all" && (engine => engine.derived.ckdStage !== kidneyFilter)(runEngine(patient))) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "hba1c") {
        const av = a.latestVisit?.labs.hba1c ?? 0;
        const bv = b.latestVisit?.labs.hba1c ?? 0;
        return bv - av;
      }
      if (sortBy === "name") return a.patient.name.localeCompare(b.patient.name);
      if (sortBy === "date") {
        return (b.latestVisit?.date ?? "").localeCompare(a.latestVisit?.date ?? "");
      }
      return 0;
    });

    return list;
  }, [rows, query, diabetesFilter, kidneyFilter, sortBy]);

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4ff]">
        <div className="text-sm text-[#6b7280]">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #e8f4fd 50%, #f0f0ff 100%)" }}>
      {/* ── Header ── */}
      <header className="bg-white/80 backdrop-blur-md border-b border-white/60 sticky top-0 z-30 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-1">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-14 w-14 shrink-0 rounded-md object-contain" />
            <div>
              <div className="text-base font-bold text-[#1e293b] leading-tight">CliniQ</div>
              <div className="text-xs text-[#64748b]">Diabetes Care Assistant</div>
            </div>
          </div>
          <button
            onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-colors duration-200"
            style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#0f172a"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, #3b82f6, #2563eb)"; }}
          >
            <PlusCircle className="h-4 w-4" />
            Generate synthetic patient
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* ── Hero Banner ── */}
        <div
          className="relative mb-8 overflow-hidden rounded-lg px-8 py-8"
          style={{ background: "linear-gradient(135deg, #f8faff 0%, #e8f4fd 60%, #f0e8ff 100%)", border: "1px solid rgba(255,255,255,0.8)" }}
        >
          {/* Decorative blobs */}
          <div className="pointer-events-none absolute right-0 top-0 h-full w-2/5 opacity-20"
            style={{ background: "radial-gradient(ellipse at 80% 20%, #93c5fd 0%, transparent 60%)" }} />
          <div className="pointer-events-none absolute right-8 bottom-0 h-48 w-48 opacity-10 rounded-full"
            style={{ background: "radial-gradient(circle, #c4b5fd 0%, transparent 70%)" }} />

          <div className="relative flex items-center justify-between gap-6">
            <div className="flex-1">
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#64748b]">Patient Management</div>
              <h1 className="mb-2 text-3xl font-bold text-[#1e293b] leading-tight">
                Your Diabetes Patients at a Glance
              </h1>
              <p className="text-sm text-[#64748b]">Track, manage and explore patient data with AI assistance.</p>

              {/* Stat Cards */}
              <div className="mt-5 flex gap-4 flex-wrap">
                <StatCard
                  icon={<Users className="h-5 w-5" style={{ color: "#3b82f6" }} />}
                  iconBg="#eff6ff"
                  value={totalPatients}
                  label="Total Patients"
                />
                <StatCard
                  icon={<Droplets className="h-5 w-5" style={{ color: "#5c4f8a" }} />}
                  iconBg="#f0edf8"
                  value={type2Count}
                  label="Type 2 Diabetes"
                />
              </div>
            </div>

            {/* Decorative illustration */}
            <div className="hidden xl:flex items-center justify-center h-40 w-52 shrink-0 opacity-80">
              <svg viewBox="0 0 200 160" className="w-full h-full" fill="none">
                {/* Clipboard */}
                <rect x="55" y="20" width="90" height="115" rx="10" fill="white" stroke="#bfdbfe" strokeWidth="2"/>
                <rect x="80" y="12" width="40" height="16" rx="8" fill="#bfdbfe"/>
                <rect x="65" y="50" width="70" height="4" rx="2" fill="#e0e7ff"/>
                <rect x="65" y="62" width="50" height="4" rx="2" fill="#e0e7ff"/>
                <rect x="65" y="74" width="60" height="4" rx="2" fill="#e0e7ff"/>
                {/* Heart */}
                <path d="M100 100 C100 100 82 88 82 78 C82 72 88 68 94 71 C97 72 100 75 100 75 C100 75 103 72 106 71 C112 68 118 72 118 78 C118 88 100 100 100 100Z" fill="#fca5a5"/>
                {/* Stethoscope */}
                <circle cx="150" cy="100" r="16" fill="none" stroke="#93c5fd" strokeWidth="3"/>
                <path d="M140 60 Q130 80 140 90" stroke="#64748b" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M155 60 Q165 80 155 90" stroke="#64748b" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M140 60 L155 60" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round"/>
                <circle cx="140" cy="58" r="4" fill="#64748b"/>
                <circle cx="155" cy="58" r="4" fill="#64748b"/>
                {/* Leaves */}
                <ellipse cx="42" cy="110" rx="14" ry="22" fill="#86efac" transform="rotate(-20 42 110)" opacity="0.7"/>
                <ellipse cx="165" cy="140" rx="12" ry="20" fill="#86efac" transform="rotate(15 165 140)" opacity="0.6"/>
              </svg>
            </div>
          </div>
        </div>

        {/* ── Search & Filters ── */}
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, MRN, or diabetes type..."
              className="w-full rounded-md border border-[#e2e8f0] bg-white py-2.5 pl-10 pr-4 text-sm text-[#374151] placeholder-[#9ca3af] shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all"
            />
          </div>

          <FilterDropdown
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            label="All diabetes types"
            value={diabetesFilter}
            onChange={setDiabetesFilter}
            options={[
              { value: "all", label: "All diabetes types" },
              { value: "type-1", label: "Type 1" },
              { value: "type-2", label: "Type 2" },
              { value: "gestational", label: "Gestational" },
              { value: "mody", label: "MODY" },
              { value: "secondary", label: "Secondary" },
            ]}
          />

          <FilterDropdown
            icon={<Activity className="h-3.5 w-3.5" />}
            label="All kidney stages"
            value={kidneyFilter}
            onChange={setKidneyFilter}
            options={[
              { value: "all", label: "All kidney stages" },
              { value: "G1", label: "G1" },
              { value: "G2", label: "G2" },
              { value: "G3a", label: "G3a" },
              { value: "G3b", label: "G3b" },
              { value: "G4", label: "G4" },
              { value: "G5", label: "G5" },
            ]}
          />

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-[#6b7280]">Sort by</span>
            <FilterDropdown
              label="Latest HbA1c"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "hba1c", label: "Latest HbA1c" },
                { value: "name", label: "Name" },
                { value: "date", label: "Last Visit" },
              ]}
            />
          </div>
        </div>

        {/* ── Patient Grid ── */}
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-white/60 p-12 text-center">
            <p className="text-sm text-[#6b7280]">No patients match your search.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(({ patient, engine, hba1cSeries, latestVisit }) => {
              const age = ageAt(patient.dob, new Date().toISOString().slice(0, 10));
              const hba1c = latestVisit?.labs.hba1c;
              const ckdStage = engine.derived.ckdStage;
              const palette = avatarPalette(patient.name);
              const dtLabel = diabetesTypeLabel(patient.diabetesType);
              const isType1 = patient.diabetesType === "type-1";
              const hba1cClr = hba1c ? hba1cColor(hba1c) : "#6b7280";
              const ckdBadge = ckdStage ? ckdStageBadgeStyle(ckdStage) : null;

              return (
                <div
                  key={patient.id}
                  onClick={() => router.push(`/patient/${patient.id}`)}
                  className="group rounded-lg bg-white shadow-sm border border-[#f1f5f9] hover:border-[#bfdbfe] transition-colors duration-200 overflow-hidden cursor-pointer"
                >
                  {/* Card Header */}
                  <div className="px-5 pt-5 pb-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                          style={{ background: palette.bg, color: palette.text }}
                        >
                          {initials(patient.name)}
                        </div>
                        <div>
                          <div className="font-semibold text-[#1e293b] text-sm leading-tight">{patient.name}</div>
                          <div className="text-xs text-[#94a3b8] mt-0.5">
                            {patient.mrn} · {age} · {patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="rounded px-2.5 py-0.5 text-xs font-semibold"
                          style={{
                            background: isType1 ? "#f0edf8" : "#edf2fb",
                            color: isType1 ? "#6b44a8" : "#2d5299",
                          }}
                        >
                          {dtLabel}
                        </span>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-full p-1 text-[#9ca3af] hover:bg-[#f1f5f9] hover:text-[#374151] transition-colors"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Stats Row */}
                    <div className="flex items-center gap-4">
                      {/* HbA1c */}
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <Droplets className="h-3.5 w-3.5 text-[#7b9ec4]" />
                          <span className="text-xs text-[#6b7280] font-medium">HbA1c</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold tabular-nums" style={{ color: hba1cClr }}>
                            {hba1c !== undefined ? `${hba1c.toFixed(1)}%` : "—"}
                          </span>
                          {hba1cSeries.length >= 2 && (
                            <MiniSparkline data={hba1cSeries} color={hba1cClr} />
                          )}
                        </div>
                      </div>

                      {/* Divider */}
                      <div className="h-10 w-px bg-[#f1f5f9]" />

                      {/* Kidney Stage */}
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <Activity className="h-3.5 w-3.5 text-[#7b9ec4]" />
                          <span className="text-xs text-[#6b7280] font-medium">Kidney stage</span>
                        </div>
                        {ckdStage && ckdBadge ? (
                          <span
                            className="inline-block rounded px-3 py-0.5 text-sm font-bold"
                            style={{ background: ckdBadge.bg, color: ckdBadge.text }}
                          >
                            {ckdStage}
                          </span>
                        ) : (
                          <span className="text-sm text-[#9ca3af]">—</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="flex items-center justify-between px-5 py-3 bg-[#f8faff] border-t border-[#f1f5f9]">
                    <div className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span>Last recorded: {latestVisit?.date ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-semibold text-[#4a6fa5] group-hover:text-[#2d5299] transition-colors">
                      View Patient
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <SafetyFooter />

      {showGenerate && (
        <GeneratePatientDialog
          onClose={() => setShowGenerate(false)}
          onCreated={(id) => {
            setShowGenerate(false);
            router.push(`/patient/${id}`);
          }}
        />
      )}
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon,
  iconBg,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconBg: string;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-white/80 backdrop-blur-sm px-4 py-3 shadow-sm border border-white/60">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold text-[#1e293b] tabular-nums leading-tight">{value}</div>
        <div className="text-xs text-[#64748b]">{label}</div>
      </div>
    </div>
  );
}
