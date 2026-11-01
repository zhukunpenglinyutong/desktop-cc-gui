/**
 * MCP inventory store: loads config + runtime for both engines, keyed on the
 * active workspace (project sources and runtime state are workspace-scoped;
 * user sources are not, but come in the same payload).
 *
 * Sequence-guarded: switching workspaces/engines or closing the page can
 * never be overwritten by a late response.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mcpApi, McpHubError } from "./api";
import type { McpConfigEntry, McpInventory, McpLaunchMode } from "./types";

export interface McpInventoryStore {
  inventory: McpInventory | null;
  loading: boolean;
  error: McpHubError | string | null;
  reload: () => Promise<void>;
  /** Toggle one entry; reloads config after the write so the UI reflects the
   *  file, not the optimistic click. */
  setEnabled: (entry: McpConfigEntry, enabled: boolean) => Promise<void>;
  /** 切换启动方式；同样写完回读，与启用开关共用 pendingId。 */
  setLaunchMode: (entry: McpConfigEntry, mode: McpLaunchMode) => Promise<void>;
  /** Entry id currently being written (only that row is disabled). */
  pendingId: string | null;
}

export function useMcpInventory(workspacePath: string | null): McpInventoryStore {
  const [inventory, setInventory] = useState<McpInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<McpHubError | string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  const reload = useCallback(async () => {
    const current = sequence.current + 1;
    sequence.current = current;
    const canCommit = () => mounted.current && sequence.current === current;
    setLoading(true);
    setError(null);
    try {
      const payload = await mcpApi.inventory(workspacePath);
      if (!canCommit()) return;
      setInventory(payload);
    } catch (loadError) {
      if (!canCommit()) return;
      setError(loadError instanceof McpHubError ? loadError : String(loadError));
    } finally {
      // 只清自己这一次的加载态；功能函数可看到最新序号，避免旧请求提前收尾。
      setLoading((value) => (canCommit() ? false : value));
    }
  }, [workspacePath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const write = useCallback(
    async (entry: McpConfigEntry, apply: () => Promise<unknown>) => {
      setPendingId(entry.id);
      setError(null);
      try {
        await apply();
        // Re-read: the write path merges with the live file, so the response
        // entry alone is not the whole truth after a partial external edit.
        await reload();
      } catch (writeError) {
        if (mounted.current) {
          setError(writeError instanceof McpHubError ? writeError : String(writeError));
        }
        throw writeError;
      } finally {
        if (mounted.current) setPendingId(null);
      }
    },
    [reload],
  );
  const setEnabled = useCallback(
    (entry: McpConfigEntry, enabled: boolean) =>
      write(entry, () => mcpApi.setEnabled(entry, enabled, workspacePath)),
    [write, workspacePath],
  );
  const setLaunchMode = useCallback(
    (entry: McpConfigEntry, mode: McpLaunchMode) =>
      write(entry, () => mcpApi.setLaunchMode(entry, mode, workspacePath)),
    [write, workspacePath],
  );

  return { inventory, loading, error, reload, setEnabled, setLaunchMode, pendingId };
}
