import Plug from "lucide-react/dist/esm/icons/plug";
import type { OpenCodeStatusSnapshot } from "../types";

type OpenCodeMcpSectionProps = {
  snapshot: OpenCodeStatusSnapshot | null;
  onToggleMcpGlobal: (enabled: boolean) => Promise<void>;
  onToggleMcpServer: (serverName: string, enabled: boolean) => Promise<void>;
};

export function OpenCodeMcpSection({
  snapshot,
  onToggleMcpGlobal,
  onToggleMcpServer,
}: OpenCodeMcpSectionProps) {
  return (
    <div className="opencode-panel-mcp mt-2.5 border-t-0 pt-0">
      <div className="opencode-mcp-head mb-1.5 flex items-center justify-between">
        <div className="opencode-provider-title inline-flex items-center gap-1.5 text-[12px] font-semibold">
          <Plug size={13} aria-hidden />
          <span>MCP</span>
        </div>
        <label className="opencode-toggle inline-flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted,#6b7280)]">
          <input
            type="checkbox"
            checked={snapshot?.mcpEnabled ?? true}
            onChange={(event) => {
              void onToggleMcpGlobal(event.target.checked);
            }}
          />
          <span>总开关</span>
        </label>
      </div>
      <div className="opencode-mcp-list flex flex-col gap-1">
        {(snapshot?.mcpServers ?? []).length === 0 && (
          <div className="opencode-mcp-empty text-[11px] text-[color:var(--text-muted,#6b7280)]">
            暂无 MCP server（可通过 opencode mcp add 添加）
          </div>
        )}
        {(snapshot?.mcpServers ?? []).map((server) => (
          <label
            key={server.name}
            className="opencode-mcp-row grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px]"
            title={server.permissionHint ?? ""}
          >
            <input
              type="checkbox"
              checked={server.enabled}
              onChange={(event) => {
                void onToggleMcpServer(server.name, event.target.checked);
              }}
            />
            <span className="opencode-mcp-name min-w-0 overflow-hidden whitespace-nowrap text-ellipsis text-[color:var(--text-strong,#111827)]">
              {server.name}
            </span>
            <span className="opencode-mcp-status text-[color:var(--text-muted,#6b7280)]">
              {server.status ?? "unknown"}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
