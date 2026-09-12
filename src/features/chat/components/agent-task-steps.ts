import type { Message, TodoItem } from "@/lib/ipc";

export type AgentTaskStepState = "active" | "complete";

export interface AgentTaskStep {
  /** Stable identity across renders (steps only append within a run). */
  key: string;
  label: string;
  state: AgentTaskStepState;
  /** Subagent type / role, e.g. "code-reviewer", "planner" */
  subagentType?: string;
  /** Detailed description or prompt preview */
  detail?: string;
}

/**
 * Live subagent/task detection from the message stream.
 *
 * Engine events carry tool calls as `role: "tool"` rows whose text is the
 * tool label (engine-dependent: Claude "Task" / "Agent" / "Workflow",
 * pi-family "task · intent", Codex/Grok spawn_* names, Kimi agent swarm).
 */
export function isSubagentToolLabel(text: string): boolean {
  if (!text) return false;
  // pi-family labels are "name · intent" — match on the tool name head.
  const head = text.split("·")[0].trim().toLowerCase();
  const first = head.split(/[\s/\\]+/)[0].replace(/-/g, "_");
  if (first === "task" || first === "agent" || first === "subagent") return true;
  if (first === "spawn" || first === "spawn_agent" || first === "spawn_subagent") return true;
  if (first === "workflow" || first === "run_workflow" || first === "pipeline") return true;
  if (first === "dispatch" || first === "dispatch_agent" || first === "delegate") return true;
  if (/^subagent\s*\d+/.test(head)) return true;
  if (head.includes("spawn agent") || head.includes("spawn subagent")) return true;
  if (head.includes("agent swarm") || head.includes("agent_swarm")) return true;
  if (head.includes("workflow") || head.includes("subagent")) return true;
  return false;
}

/** Extract descriptive label, role type, and detail from tool call payload. */
export function extractSubagentTaskInfo(message: Message): {
  label: string;
  subagentType?: string;
  detail?: string;
} {
  const args = (message.args && typeof message.args === "object" ? message.args : {}) as Record<string, unknown>;

  const subagentType =
    typeof args.subagent_type === "string" && args.subagent_type.trim()
      ? args.subagent_type.trim()
      : typeof args.type === "string" && args.type.trim()
        ? args.type.trim()
        : undefined;

  const descCandidates = [
    args.description,
    args.subject,
    args.activeForm,
    args.title,
    args.task,
    args.prompt,
  ];
  let description: string | undefined;
  for (const c of descCandidates) {
    if (typeof c === "string" && c.trim()) {
      description = c.trim();
      break;
    }
  }

  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined;

  let label = message.text;
  if (message.text.includes("·")) {
    label = message.text;
  } else if (description) {
    if (subagentType) {
      label = `[${subagentType}] ${description}`;
    } else if (name) {
      label = `[${name}] ${description}`;
    } else {
      label = description;
    }
  } else if (subagentType) {
    label = name ? `[${subagentType}] ${name}` : `[${subagentType}] ${message.text}`;
  } else if (name) {
    label = `[${name}] ${message.text}`;
  }

  let detail: string | undefined;
  if (typeof args.prompt === "string" && args.prompt.trim() && args.prompt.trim() !== description) {
    detail = args.prompt.trim();
  } else if (typeof args.description === "string" && args.description.trim() && args.description.trim() !== description) {
    detail = args.description.trim();
  }

  return { label, subagentType, detail };
}

/** The subagents one delegation call names, in call order. A `task` call
 *  spells out the agents it spawns under `tasks[]`; a `hub` wait names the
 *  ids it is waiting on. A call that names none (a roster check, a bare
 *  delegation) is left to the caller as a single step of its own. */
export function subagentRefsFromArgs(args: unknown): {
  id: string;
  label?: string;
  agent?: string;
  detail?: string;
}[] {
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  const refs: { id: string; label?: string; agent?: string; detail?: string }[] = [];
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  for (const entry of Array.isArray(record.tasks) ? record.tasks : []) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    // `name` is the job id the run reports back ("CoreInvokeFilterParse");
    // older shapes only carry an id.
    const id = text(row.name) ?? text(row.id) ?? text(row.label);
    if (!id) continue;
    const task = text(row.task) ?? text(row.prompt);
    refs.push({
      id,
      label: text(row.description) ?? id,
      agent: text(row.agent) ?? text(row.subagent_type),
      // The instruction text is the useful detail; its first line is enough.
      detail: task ? task.split("\n").find((line) => line.trim()) ?? undefined : undefined,
    });
  }
  for (const entry of Array.isArray(record.ids) ? record.ids : []) {
    const id = text(entry);
    if (id) refs.push({ id });
  }
  return refs;
}

/** Edit-class tool labels (write/edit/patch families) — the file
 * modification surface. Mirrors the edit branch of ProcessDisclosure's
 * toolTypeKey. */
export function isEditToolLabel(text: string): boolean {
  const head = text.split("·")[0].trim().toLowerCase();
  const first = head.split(/[\s/\\]+/)[0].replace(/-/g, "_");
  return [
    "write",
    "edit",
    "write_file",
    "edit_file",
    "apply_patch",
    "patch",
    "notebook_edit",
    "multiedit",
    "multi_edit",
  ].includes(first);
}

/** Index just past the last user message — the start of the current turn. */
function currentTurnStart(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i + 1;
  }
  return 0;
}

/**
 * Fold subagent tool rows across the session into panel steps.
 * Steps in prior turns are settled/complete; current-turn steps stay active
 * while streaming until tool result returns or subsequent assistant response arrives.
 *
 * A call is counted by the subagents it names, not by the call itself: one
 * `task` can dispatch four agents ("Spawned 4 background agents") and one
 * `hub` wait can cover them again, so a per-call count showed 2 where four
 * were running. Ids name the subagent, so a later wait on them adds nothing.
 */
export function deriveAgentTaskSteps(
  messages: Message[],
  streaming: boolean,
  engine: string,
): AgentTaskStep[] {
  const turnStart = currentTurnStart(messages);
  const blockingSpawn = engine === "claude";
  const steps: AgentTaskStep[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool") continue;
    // Naming ids is itself proof of delegation (`hub` waits carry a generic
    // "hub ·…" label the name heuristic cannot classify).
    const refs = subagentRefsFromArgs(message.args);
    if (refs.length === 0 && !isSubagentToolLabel(message.text)) continue;

    const isCurrentTurn = i >= turnStart;
    let settled = !isCurrentTurn || !streaming;

    if (!settled) {
      if (message.result !== undefined && message.result !== null) {
        settled = true;
      } else {
        for (let j = i + 1; j < messages.length; j++) {
          const later = messages[j];
          if (later.role === "assistant" || later.role === "thinking") {
            settled = true;
            break;
          }
          if (blockingSpawn) {
            settled = true;
            break;
          }
        }
      }
    }

    const info = extractSubagentTaskInfo(message);
    const state = settled ? "complete" : "active";
    if (refs.length === 0) {
      steps.push({
        key: String(message.seq),
        label: info.label,
        state,
        subagentType: info.subagentType,
        detail: info.detail,
      });
      continue;
    }
    for (const ref of refs) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      steps.push({
        key: `${message.seq}:${ref.id}`,
        label: ref.label ?? ref.id,
        state,
        subagentType: ref.agent ?? info.subagentType,
        detail: ref.detail ?? info.detail,
      });
    }
  }
  return steps;
}

/**
 * Unique files touched by edit-class tools across the whole loaded session,
 * in first-edit order — the reference app's contract: the 已编辑 pill is
 * session-scoped (survives turn boundaries and history reopen), not
 * turn-scoped. Paths come from the tool start's path arg, so only edits
 * with a real file target count.
 */
export function deriveEditedFiles(messages: Message[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool" || !message.path) continue;
    if (!isEditToolLabel(message.text)) continue;
    // Tool rows also record non-file targets (xd:// device endpoints, URLs)
    // — real file paths never carry a URI scheme.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(message.path)) continue;
    if (seen.has(message.path)) continue;
    seen.add(message.path);
    files.push(message.path);
  }
  return files;
}

/**
 * Fold todo tool payloads across the whole loaded session into the current
 * list. Two wire semantics: `replace` snapshots swap the list outright
 * (TodoWrite-style full rewrites, init/clear ops); otherwise the payload is
 * a patch matched by id or content (start/done/block/unblock), and "dropped"
 * removes the item. Session-scoped like the edited-files pill.
 */
export function deriveTodoList(messages: Message[]): TodoItem[] {
  let items: TodoItem[] = [];

  // Map taskId -> original task subject for Claude Code TaskCreate/TaskUpdate tracking
  const taskIdToContent = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool") {
      const toolName = message.text.toLowerCase();
      if (toolName.includes("taskcreate") || toolName.includes("task_create")) {
        const args = (message.args && typeof message.args === "object" ? message.args : {}) as Record<string, unknown>;
        const subject = typeof args.subject === "string" ? args.subject.trim() : "";
        if (subject && typeof message.result === "string") {
          const match = message.result.match(/Task\s*#?(\w+)/i);
          if (match) {
            taskIdToContent.set(match[1], subject);
          }
        }
      }
    }
  }

  for (const message of messages) {
    const payload = message.todos;
    if (!payload) continue;
    if (payload.replace) {
      items = payload.items.filter((item) => item.status !== "dropped");
      continue;
    }
    for (const patch of payload.items) {
      let idx = -1;
      if (patch.id) {
        idx = items.findIndex((item) => item.id === patch.id);
        if (idx < 0 && taskIdToContent.has(patch.id)) {
          const mappedContent = taskIdToContent.get(patch.id);
          idx = items.findIndex((item) => item.content === mappedContent);
        }
      }
      if (idx < 0 && patch.content) {
        idx = items.findIndex((item) => item.content === patch.content);
      }

      if (patch.status === "dropped") {
        if (idx >= 0) items = items.filter((_, j) => j !== idx);
        continue;
      }
      if (idx >= 0) {
        const existing = items[idx];
        items[idx] = {
          ...existing,
          ...patch,
          content: patch.content ? patch.content : existing.content,
        };
      } else if (patch.content) {
        items = [...items, patch];
      }
    }
  }
  return items;
}
