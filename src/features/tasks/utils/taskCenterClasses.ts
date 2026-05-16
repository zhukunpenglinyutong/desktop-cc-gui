import type { TaskRunSurfaceSeverity } from "./taskRunSurface";

/**
 * Tailwind utility class strings for `.task-center__badge--<severity>` and
 * related task-center surfaces. Extracted from `workspace-home.css` during the
 * Phase 5 coss.ui migration so that `WorkspaceHome.tsx` and
 * `TaskCenterView.tsx` can share the same severity-driven palette without
 * relying on CSS class cascade.
 *
 * Each helper returns the colour-mix / surface utility classes that match the
 * original CSS — the structural marker class name (e.g. `task-center__badge`,
 * `task-center__run`, etc.) is preserved as a no-op anchor for screenshot
 * debug and query-selector tests.
 */

export function taskCenterBadgeClasses(severity: TaskRunSurfaceSeverity): string {
  switch (severity) {
    case "active":
      return "border-[color-mix(in_srgb,#2563eb_44%,var(--border-subtle))] bg-[color-mix(in_srgb,#2563eb_16%,var(--surface-card))] text-[color-mix(in_srgb,#2563eb_88%,var(--text-strong))]";
    case "attention":
      return "border-[color-mix(in_srgb,var(--status-warning)_46%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-warning)_16%,var(--surface-card))] text-[color-mix(in_srgb,var(--status-warning)_88%,var(--text-strong))]";
    case "danger":
      return "border-[color-mix(in_srgb,var(--status-error)_46%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-error)_16%,var(--surface-card))] text-[color-mix(in_srgb,var(--status-error)_88%,var(--text-strong))]";
    case "success":
      return "border-[color-mix(in_srgb,var(--status-success)_46%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-success)_16%,var(--surface-card))] text-[color-mix(in_srgb,var(--status-success)_88%,var(--text-strong))]";
    case "muted":
    default:
      return "border-[color-mix(in_srgb,var(--text-faint)_36%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--text-faint)_14%,var(--surface-card))] text-[color-mix(in_srgb,var(--text-faint)_88%,var(--text-strong))]";
  }
}

export function taskCenterRunClasses(severity: TaskRunSurfaceSeverity): string {
  switch (severity) {
    case "active":
      return "border-[color-mix(in_srgb,#2563eb_36%,var(--border-subtle))] bg-[color-mix(in_srgb,#2563eb_10%,var(--surface-card-muted))]";
    case "attention":
      return "border-[color-mix(in_srgb,var(--status-warning)_38%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-warning)_12%,var(--surface-card-muted))]";
    case "danger":
      return "border-[color-mix(in_srgb,var(--status-error)_38%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-error)_12%,var(--surface-card-muted))]";
    case "success":
      return "border-[color-mix(in_srgb,var(--status-success)_38%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-success)_12%,var(--surface-card-muted))]";
    case "muted":
    default:
      return "border-[color-mix(in_srgb,var(--text-faint)_24%,var(--border-subtle))]";
  }
}

export function taskCenterDetailClasses(severity: TaskRunSurfaceSeverity): string {
  switch (severity) {
    case "active":
      return "border-[color-mix(in_srgb,#2563eb_42%,var(--border-subtle))] bg-[linear-gradient(180deg,color-mix(in_srgb,#2563eb_12%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-strong)_94%,transparent))]";
    case "attention":
      return "border-[color-mix(in_srgb,var(--status-warning)_40%,var(--border-subtle))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--status-warning)_12%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-strong)_94%,transparent))]";
    case "danger":
      return "border-[color-mix(in_srgb,var(--status-error)_40%,var(--border-subtle))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--status-error)_12%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-strong)_94%,transparent))]";
    case "success":
      return "border-[color-mix(in_srgb,var(--status-success)_40%,var(--border-subtle))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--status-success)_12%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-strong)_94%,transparent))]";
    case "muted":
    default:
      return "border-[color-mix(in_srgb,var(--border-subtle)_84%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_94%,transparent),color-mix(in_srgb,var(--surface-card-strong)_92%,transparent))]";
  }
}
