import type { CSSProperties } from "react";
import Zap from "lucide-react/dist/esm/icons/zap";

type ProxyStatusBadgeProps = {
  proxyUrl?: string | null;
  label?: string;
  variant?: "compact" | "prominent";
  animated?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
};

function normalizeProxyHost(proxyUrl: string | null | undefined): string | null {
  const raw = proxyUrl?.trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    return parsed.host || raw;
  } catch {
    return raw
      .replace(/^[a-z]+:\/\//i, "")
      .replace(/\/+$/, "")
      .trim() || null;
  }
}

export function ProxyStatusBadge({
  proxyUrl = null,
  label = "Proxy",
  variant = "compact",
  animated = false,
  className = "",
  style,
  title,
}: ProxyStatusBadgeProps) {
  const host = normalizeProxyHost(proxyUrl);
  const resolvedTitle = title ?? (host ? `${label} · ${host}` : label);
  const stateClassName = animated ? "proxy-status-badge--animated" : "";

  return (
    <span
      className={`proxy-status-badge proxy-status-badge--${variant}${stateClassName ? ` ${stateClassName}` : ""}${className ? ` ${className}` : ""}`}
      style={style}
      title={resolvedTitle}
      aria-label={resolvedTitle}
    >
      <span className="proxy-status-badge__halo" aria-hidden />
      <Zap
        size={variant === "prominent" ? 13 : 10}
        className="proxy-status-badge__icon"
        aria-hidden
      />
    </span>
  );
}
