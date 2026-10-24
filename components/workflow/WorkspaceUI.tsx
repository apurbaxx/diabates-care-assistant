import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function WorkspaceIcon({ icon: Icon, className = "" }: { icon: LucideIcon; className?: string }) {
  return <span className={`workspace-icon ${className}`}><Icon size={20} strokeWidth={1.8} /></span>;
}

export function WorkspacePanel({ title, icon, count, actions, children, className = "" }: {
  title: string; icon: LucideIcon; count?: number; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`workspace-panel ${className}`}>
    <div className="workspace-panel-heading">
      <div className="flex min-w-0 items-center gap-2.5"><WorkspaceIcon icon={icon} /><h2>{title}</h2>{count !== undefined && <span className="workspace-count">{count}</span>}</div>
      {actions && <div className="workspace-panel-actions">{actions}</div>}
    </div>
    {children}
  </section>;
}

export function PatientAvatar({ name }: { name: string }) {
  const tones = ["violet", "blue", "amber", "pink"];
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const initials = name.trim().split(/\s+/).map(part => part[0]).join("").slice(0,2).toUpperCase();
  return <span aria-hidden="true" className={`workspace-avatar workspace-avatar-${tones[hash % tones.length]}`}>{initials}</span>;
}

export function WorkflowStatus({ status }: { status: string }) {
  const label: Record<string,string> = { scheduled: "Scheduled", arrived: "Arrived", completed: "Completed", cancelled: "Cancelled", pending: "Pending", "in-progress": "In progress", draft: "Draft", "pending-review": "Awaiting approval", approved: "Approved" };
  return <span className={`workspace-status workspace-status-${status}`}><span />{label[status] || status}</span>;
}
