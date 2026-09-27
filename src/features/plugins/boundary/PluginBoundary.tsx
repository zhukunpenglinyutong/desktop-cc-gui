import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "@/lib/i18n";
import { notePluginRenderOk, reportPluginCrash } from "../runtime/loader";

/**
 * Per-plugin ErrorBoundary (plan §4.1 boundary/ + acceptance 1b): every
 * plugin-owned UI mount point renders inside one of these. A render crash
 * unmounts only the plugin's subtree — the host chat UI is never taken down.
 * Crash counting is cumulative across mount points (the loader keeps one
 * counter per plugin id, reset by a successful mount); past the loader's
 * threshold the plugin is unloaded and quarantined automatically. A failed
 * mount renders a retry affordance — retrying remounts the children without
 * reloading the plugin.
 */
export class PluginBoundary extends Component<
  { pluginId: string; children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo) {
    reportPluginCrash(this.props.pluginId, error);
  }

  override componentDidMount() {
    notePluginRenderOk(this.props.pluginId);
  }

  override render() {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="flex items-center gap-2 text-body-medium text-text-tertiary">
          <span>{i18n.t("plugins.boundary.crashed")}</span>
          <button
            type="button"
            onClick={() => this.setState({ failed: false })}
            className="cursor-pointer rounded-lg bg-background-secondary-default px-2 py-1 text-body-medium text-text-primary transition-colors hover:bg-background-secondary-hover"
          >
            {i18n.t("plugins.boundary.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
