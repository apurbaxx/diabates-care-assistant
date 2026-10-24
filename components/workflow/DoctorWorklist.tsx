"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, CalendarDays, ClipboardCheck, FileCheck2, FileText, FlaskConical, MoreHorizontal, Plus, PlusCircle, Users, Zap } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { Appointment } from "@/lib/workflow/types";
import { localDay } from "@/lib/workflow/validation";
import { ageAt } from "@/lib/clinical/derive";
import { Action, controlClass, Feedback } from "./WorkflowUI";
import { PatientAvatar, WorkflowStatus, WorkspaceIcon, WorkspacePanel } from "./WorkspaceUI";
import { BrowserStoragePanel } from "./BrowserStoragePanel";

const statuses: Appointment["status"][] = ["scheduled", "arrived", "completed", "cancelled"];
function localDateTime(iso: string) {
  const date = new Date(iso);
  return `${localDay(date)}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}
function dateLabel(date: string) {
  if (!date) return "Date needs review";
  return new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleString(undefined, date.length === 10 ? { year: "numeric", month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function DoctorWorklist({ children, onGeneratePatient }: { children?: ReactNode; onGeneratePatient?: () => void }) {
  const patients = useAppStore(s => s.patients);
  const appointments = useAppStore(s => s.appointments);
  const summaries = useAppStore(s => s.summaries);
  const tasks = useAppStore(s => s.tasks);
  const [today, setToday] = useState(localDay());
  const [date, setDate] = useState(localDay());
  const [dateMode, setDateMode] = useState<"day" | "week" | "all">("day");
  const [appointment, setAppointment] = useState<Partial<Appointment>>();
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [taskFilter, setTaskFilter] = useState("open");
  const [expandedReports, setExpandedReports] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState(false);
  useEffect(() => { const timer = setInterval(() => setToday(localDay()), 30_000); return () => clearInterval(timer); }, []);

  const patientName = (id: string) => patients.find(p => p.id === id)?.name || "Patient unavailable";
  const pendingReports = patients.flatMap(patient => patient.labReports.filter(r => !r.acknowledged && r.status !== "rejected").map(report => ({ patient, report })));
  const pendingSummaries = summaries.filter(s => s.status !== "approved");
  const openTasks = tasks.filter(t => t.status !== "completed");
  const filteredTasks = tasks.filter(t => taskFilter === "all" || (taskFilter === "open" ? t.status !== "completed" : t.status === "completed"));
  const stats = [
    { label: "Total patients", value: patients.length, target: "patient-list", icon: Users, tone: "blue" },
    { label: "Today's appointments", value: appointments.filter(a => localDay(new Date(a.startsAt)) === today && a.status !== "cancelled").length, target: "appointments", icon: CalendarDays, tone: "green" },
    { label: "Reports awaiting verification", value: pendingReports.length, target: "report-worklist", icon: FileText, tone: "amber" },
    { label: "Summaries awaiting approval", value: pendingSummaries.length, target: "summary-worklist", icon: FileText, tone: "violet" },
    { label: "Pending documentation tasks", value: openTasks.filter(t => t.kind !== "report").length, target: "workflow-tasks", icon: ClipboardCheck, tone: "pink" },
  ];
  const weekStart = new Date(`${today}T12:00:00`);
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const dayAppointments = appointments.filter(a => {
    const day = localDay(new Date(a.startsAt));
    return dateMode === "all" || (dateMode === "week" ? day >= localDay(weekStart) && day <= localDay(weekEnd) : !date || day === date);
  }).sort((a,b) => a.startsAt.localeCompare(b.startsAt));
  function newAppointment() {
    setAppointment({ patientId: "", status: "scheduled", reason: "" }); setStartsAt("");
    requestAnimationFrame(() => document.getElementById("appointments")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function save() {
    try {
      if (!appointment || !startsAt) throw new Error("Select a patient and appointment date/time");
      const at = new Date().toISOString();
      useAppStore.getState().saveAppointment({ id: appointment.id || crypto.randomUUID(), patientId: appointment.patientId || "", startsAt: new Date(startsAt).toISOString(), reason: appointment.reason || "", status: appointment.status || "scheduled", createdAt: appointment.createdAt || at, updatedAt: at });
      setAppointment(undefined); setError(""); setMessage("Appointment saved");
    } catch (e) { setError((e as Error).message); }
  }
  function cancelAppointment(record: Appointment) {
    try { useAppStore.getState().saveAppointment({ ...record, status: "cancelled" }); setError(""); setMessage("Appointment cancelled"); }
    catch (e) { setError((e as Error).message); }
  }

  return <div>
    <div className="workspace-intro">
      <h1>Doctor workspace</h1>
      <p>Your patients, appointments and tasks at a glance <span>·</span> Synthetic demonstration records</p>
      <div className="workspace-current-date"><CalendarDays size={16} /><time dateTime={today}>{new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "full" })}</time></div>
    </div>
    <Feedback error={error} message={message} />
    <div className="workspace-metrics">{stats.map(stat => <a href={`#${stat.target}`} key={stat.label} onClick={() => { if (stat.target === "appointments") { setDate(today); setDateMode("day"); } }} className={`workspace-metric workspace-metric-${stat.tone}`}><WorkspaceIcon icon={stat.icon} /><div><strong>{stat.value}</strong><span>{stat.label}</span></div></a>)}</div>
    <div className="workspace-columns">
      <div className="workspace-primary-column">
        <div id="appointments" className="workspace-anchor"><WorkspacePanel title={dateMode === "day" && date === today ? "Today's schedule" : dateMode === "week" ? "This week's schedule" : "Appointments"} icon={CalendarDays} actions={<>
          <label className="workspace-date-picker"><CalendarDays size={14} /><input aria-label="Appointment day" type="date" value={date} onChange={e => { setDate(e.target.value); setDateMode("day"); }} /></label>
          <button className={`workspace-button workspace-button-small ${dateMode === "day" && date === today ? "is-active" : ""}`} onClick={() => { setDate(today); setDateMode("day"); }}>Today</button>
          <button className={`workspace-button workspace-button-small ${dateMode === "week" ? "is-active" : ""}`} onClick={() => setDateMode("week")}>This week</button>
          <button className={`workspace-button workspace-button-small ${dateMode === "all" ? "is-active" : ""}`} onClick={() => { setDate(""); setDateMode("all"); }}>All dates</button>
          <button className="workspace-button workspace-button-primary workspace-button-small" disabled={!patients.length} onClick={newAppointment}><Plus size={16} />Create appointment</button>
        </>}>
          {appointment && <div className="workspace-appointment-editor"><h3>{appointment.id ? "Edit appointment" : "New appointment"}</h3><div className="grid gap-3 sm:grid-cols-2">
            <label>Patient<select aria-label="Appointment patient" className={controlClass} value={appointment.patientId || ""} disabled={appointment.status === "completed"} onChange={e => setAppointment({ ...appointment, patientId: e.target.value })}><option value="">Select a synthetic patient</option>{patients.map(p => <option key={p.id} value={p.id}>{p.name} · {p.mrn}</option>)}</select></label>
            <label>Date and time (your timezone)<input aria-label="Appointment time" className={controlClass} type="datetime-local" value={startsAt} disabled={appointment.status === "completed"} onChange={e => setStartsAt(e.target.value)} /></label>
            <label>Reason<input aria-label="Appointment reason" className={controlClass} value={appointment.reason || ""} maxLength={500} onChange={e => setAppointment({ ...appointment, reason: e.target.value })} /></label>
            <label>Status<select aria-label="Appointment status" className={controlClass} value={appointment.status} onChange={e => setAppointment({ ...appointment, status: e.target.value as Appointment["status"] })}>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          </div><div className="mt-3 flex gap-2"><Action primary onClick={save}>Save appointment</Action><Action onClick={() => setAppointment(undefined)}>Close editor</Action></div></div>}
          <div className="workspace-schedule-scroll"><table className="workspace-schedule-table"><thead><tr>{["Time", "Patient", "Reason", "Status", "Actions"].map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>
            {dayAppointments.map(record => {
              const patient = patients.find(p => p.id === record.patientId);
              return <tr key={record.id}><td><time dateTime={record.startsAt}>{new Date(record.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>{dateMode !== "day" && <small>{dateLabel(record.startsAt.slice(0,10))}</small>}</td><td><Link href={`/patient/${record.patientId}`} className="workspace-schedule-patient"><PatientAvatar name={patientName(record.patientId)} /><span><strong>{patientName(record.patientId)}</strong>{patient && <small>{patient.mrn} · {ageAt(patient.dob, today)} · {patient.sex === "female" ? "Female" : "Male"}</small>}</span></Link></td><td><span>{record.reason}</span>{patient && <span className="workspace-diabetes-badge">{patient.diabetesType.replace("type-", "Type ")}</span>}</td><td><WorkflowStatus status={record.status} /></td><td><div className="workspace-schedule-actions"><Link href={`/patient/${record.patientId}`} className="workspace-button workspace-button-small">View patient</Link><details className="workspace-row-menu"><summary aria-label={`Actions for ${patientName(record.patientId)}`}><MoreHorizontal size={17} /></summary><div><button className="workspace-text-button" onClick={() => { setAppointment(record); setStartsAt(localDateTime(record.startsAt)); }}>Edit</button>{!["cancelled","completed"].includes(record.status) && <button className="workspace-text-button" onClick={() => cancelAppointment(record)}>Cancel</button>}</div></details></div></td></tr>;
            })}
          </tbody></table></div>
          {!dayAppointments.length && <div className="workspace-empty"><CalendarDays size={24} /><p>No appointments scheduled for {dateMode === "all" ? "the selected dates" : dateMode === "week" ? "this week" : date || "this day"}. Create an appointment to add it to the worklist.</p></div>}
        </WorkspacePanel></div>

        {children}

        <WorkspacePanel title="Quick actions" icon={Zap} className="workspace-quick-actions"><div className="workspace-quick-action-links">
          <button className="workspace-button" aria-label="Create appointment from quick actions" disabled={!patients.length} onClick={newAppointment}><PlusCircle size={16} />Create appointment</button>
          <a href="#report-worklist" className="workspace-button"><FileCheck2 size={16} />Review lab reports</a>
          <a href="#summary-worklist" className="workspace-button"><FileText size={16} />Review visit summaries</a>
          <Link href="/knowledge-assistant" className="workspace-button"><BookOpen size={16} />Explore guidelines</Link>
          {onGeneratePatient && <button className="workspace-button" onClick={onGeneratePatient}><Users size={16} />Generate patient</button>}
        </div></WorkspacePanel>
        <div className="workspace-backups"><BrowserStoragePanel /></div>
      </div>

      <aside className="workspace-review-column" aria-label="Clinical review worklists">
        <div id="report-worklist" className="workspace-anchor"><WorkspacePanel title="Reports awaiting verification" icon={FileText} count={pendingReports.length} actions={<button className="workspace-text-button" onClick={() => setExpandedReports(!expandedReports)} aria-expanded={expandedReports}>{expandedReports ? "Show less" : "View all"}</button>}>
          {!pendingReports.length ? <div className="workspace-queue-empty">No reports awaiting verification.</div> : <ul className={`workspace-queue ${expandedReports ? "workspace-queue-expanded" : ""}`}>{pendingReports.map(({ patient, report }) => <li key={`${patient.id}:${report.id}`}><WorkspaceIcon icon={FileText} /><div className="workspace-queue-copy"><Link href={`/patient/${patient.id}#report=${encodeURIComponent(report.id)}`}>{patient.name}</Link><p title={report.fileName || "Pasted report"}>{report.fileName || "Pasted report"}</p><small>{dateLabel(report.uploadedAt || report.date)}</small></div><WorkflowStatus status="pending" /><Link className="workspace-button workspace-button-small" href={`/patient/${patient.id}#report=${encodeURIComponent(report.id)}`}>Review</Link></li>)}</ul>}
        </WorkspacePanel></div>
        <div id="summary-worklist" className="workspace-anchor"><WorkspacePanel title="Pending visit summaries" icon={FileText} count={pendingSummaries.length} actions={<button className="workspace-text-button" onClick={() => setExpandedSummaries(!expandedSummaries)} aria-expanded={expandedSummaries}>{expandedSummaries ? "Show less" : "View all"}</button>}>
          {!pendingSummaries.length ? <div className="workspace-queue-empty">No draft or pending visit summaries.</div> : <ul className={`workspace-queue ${expandedSummaries ? "workspace-queue-expanded" : ""}`}>{pendingSummaries.map(summary => <li key={summary.id}><WorkspaceIcon icon={FileText} /><div className="workspace-queue-copy"><Link href={`/patient/${summary.patientId}#summary=${encodeURIComponent(summary.id)}`}>{patientName(summary.patientId)}</Link><p>Visit summary · {summary.visitDate}</p><small>Revision {summary.revision} · saved {dateLabel(summary.updatedAt)}</small></div><WorkflowStatus status={summary.status} /><Link className="workspace-button workspace-button-small" href={`/patient/${summary.patientId}#summary=${encodeURIComponent(summary.id)}`}>Review</Link></li>)}</ul>}
        </WorkspacePanel></div>
        <div id="workflow-tasks" className="workspace-anchor"><WorkspacePanel title="Administrative tasks" icon={ClipboardCheck} count={filteredTasks.length} actions={<button className="workspace-text-button" onClick={() => setExpandedTasks(!expandedTasks)} aria-expanded={expandedTasks}>{expandedTasks ? "Show less" : "View all"}</button>}>
          <div className="workspace-task-toolbar"><select aria-label="Task filter" value={taskFilter} onChange={e => setTaskFilter(e.target.value)}><option value="open">Open tasks</option><option value="completed">Completed tasks</option><option value="all">All tasks</option></select></div>
          {!filteredTasks.length ? <div className="workspace-queue-empty">No tasks match this filter. Report uploads, saved summaries and completed appointments create linked tasks automatically.</div> : <ul className={`workspace-queue workspace-task-queue ${expandedTasks ? "workspace-queue-expanded" : ""}`}>{filteredTasks.map(task => {
            const href = `/patient/${task.patientId}#${task.kind === "report" ? `report=${encodeURIComponent(task.sourceId)}` : task.kind === "summary" ? `summary=${encodeURIComponent(task.sourceId)}` : "summaries"}`;
            return <li key={task.id}><WorkspaceIcon icon={task.kind === "report" ? FlaskConical : FileText} /><div className="workspace-queue-copy"><Link href={href}>{task.title} · {patientName(task.patientId)}</Link><small>Updated {dateLabel(task.updatedAt)}</small></div><select aria-label={`Task status ${task.id}`} className={`workspace-task-status workspace-task-status-${task.status}`} value={task.status} onChange={e => { try { useAppStore.getState().setTaskStatus(task.id, e.target.value as typeof task.status); setError(""); } catch (err) { setError((err as Error).message); } }}><option value="pending">Pending</option><option value="in-progress">In progress</option><option value="completed">Completed</option></select><Link href={href} className="workspace-button workspace-button-small">Open</Link></li>;
          })}</ul>}
          <p className="workspace-task-note">Task completion does not verify a report or approve a summary.</p>
        </WorkspacePanel></div>
      </aside>
    </div>
  </div>;
}
