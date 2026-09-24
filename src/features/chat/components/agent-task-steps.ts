import type { Message, TodoItem, TodosPayload } from "@/lib/ipc";

/** The settled-without-success states (`failed`, `stopped`, `interrupted`)
 *  are real task data only: the message-derived fold below never produces
 *  them (`agentState` reads a dead subagent as complete), so steps built
 *  from the task table are their only source. */
export type AgentTaskStepState = "active" | "complete" | "failed" | "stopped" | "interrupted";

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

export type SubagentRef = {
  id: string;
  label?: string;
  agent?: string;
  detail?: string;
};

const argText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Tool args reach the panel as the harness wrote them, and some runs encode
 *  an array as its JSON text; a non-array, non-parsing value names nobody. */
const argArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** The agents a `tasks[]` dispatch spells out. This is the only call shape
 *  that states an agent's kind and assignment, so it is also the source every
 *  later id-only reference inherits from. */
function dispatchRefsFromArgs(args: unknown): SubagentRef[] {
  if (!args || typeof args !== "object") return [];
  const refs: SubagentRef[] = [];
  for (const entry of argArray((args as Record<string, unknown>).tasks)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    // `name` is the job id the run reports back ("CoreInvokeFilterParse");
    // older shapes only carry an id.
    const id = argText(row.name) ?? argText(row.id) ?? argText(row.label);
    if (!id) continue;
    refs.push({
      id,
      label: argText(row.description) ?? id,
      agent: argText(row.agent) ?? argText(row.subagent_type),
      // The assignment is what the panel shows on click, so it stays whole.
      detail: argText(row.task) ?? argText(row.prompt),
    });
  }
  return refs;
}

/** The ids a coordination (`hub`) call names on its own — a wait, a cancel,
 *  a targeted roster check. These say who is out there, never what kind of
 *  agent it is or what it was told to do. */
function waitIdsFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const ids: string[] = [];
  for (const entry of argArray((args as Record<string, unknown>).ids)) {
    const id = argText(entry);
    // hub background job handles are processes/waits, not delegated agents.
    if (id && !/^bg_/i.test(id)) ids.push(id);
  }
  return ids;
}

/** The subagents one delegation call names, in call order. A `task` call
 *  spells out the agents it spawns under `tasks[]`; a `hub` wait names the
 *  ids it is waiting on. A call that names none (a roster check, a bare
 *  delegation) is left to the caller as a single step of its own. */
export function subagentRefsFromArgs(args: unknown): SubagentRef[] {
  const refs = dispatchRefsFromArgs(args);
  for (const id of waitIdsFromArgs(args)) refs.push({ id });
  return refs;
}

/** The dispatch behind an id a `hub` call named on its own. The id the run
 *  reports back is not always the name the dispatch asked for: a re-spawn is
 *  disambiguated with a numeric suffix, so "PluginReview-2" is the runtime id
 *  of the agent dispatched as "PluginReview". Only a trailing `-<digits>`
 *  counts — looser prefix matching would let unrelated agents inherit each
 *  other's kind and assignment. */
function resolveDispatch(
  id: string,
  dispatched: Map<string, SubagentRef>,
): SubagentRef | undefined {
  const exact = dispatched.get(id);
  if (exact) return exact;
  const base = id.replace(/-\d+$/, "");
  return base === id ? undefined : dispatched.get(base);
}

function agentState(status: unknown): AgentTaskStepState | undefined {
  if (typeof status !== "string") return undefined;
  switch (status.trim().toLowerCase()) {
    case "active":
    case "in_progress":
    case "pending":
    case "queued":
    case "running":
      return "active";
    case "canceled":
    case "cancelled":
    case "complete":
    case "completed":
    case "failed":
    case "idle":
    case "parked":
    case "stopped":
      return "complete";
    default:
      return undefined;
  }
}

/** Job states a `hub` result reports about itself: `details.jobs` on a wait,
 *  `details.peers` on a roster, `details.progress` on a dispatch. Unknown
 *  states are ignored instead of being guessed terminal. */
function jobStatesFromResult(result: unknown): Map<string, AgentTaskStepState> {
  const states = new Map<string, AgentTaskStepState>();
  if (!result || typeof result !== "object") return states;
  const details = (result as Record<string, unknown>).details;
  if (!details || typeof details !== "object") return states;
  const buckets = ["jobs", "peers", "progress"].map((key) =>
    (details as Record<string, unknown>)[key],
  );
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const entry of bucket) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const state = agentState(row.status);
      if (id && state) states.set(id, state);
    }
  }
  return states;
}

/** An unfiltered `hub jobs` result is the complete process-local roster. */
function isCompleteJobsRoster(message: Message): boolean {
  if (!message.result || typeof message.result !== "object") return false;
  const details = (message.result as Record<string, unknown>).details;
  if (!details || typeof details !== "object") return false;
  const args = message.args && typeof message.args === "object"
    ? message.args as Record<string, unknown>
    : {};
  const roster = details as Record<string, unknown>;
  return roster.op === "jobs" &&
    // Any filter arg (`ids`, a future `status`, …) means a partial roster,
    // not the complete one — only a bare `op`-only call qualifies.
    Object.keys(args).every((key) => key === "op") &&
    Array.isArray(roster.jobs) &&
    roster.jobs.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const row = entry as Record<string, unknown>;
      return typeof row.id === "string" && !!row.id.trim() && agentState(row.status) !== undefined;
    });
}

/** Tool name head of a tool row's label ("task · Dispatching…" → "task").
 *  The tag a row falls back to when the harness names no agent kind: the
 *  `task` tool writes `agent` on some dispatches (scout batches) and omits it
 *  on others (task batches), and a row with no tag at all says nothing about
 *  where it came from.
 *
 *  `hub` is excluded: it is the coordination tool, not an agent kind, so a
 *  wait-named agent whose dispatch cannot be resolved must render untagged
 *  rather than claim a kind it never had.
 */
function toolHead(text: string): string | undefined {
  const head = text.split("·")[0].trim().split(/[\s/\\]+/)[0];
  if (!head || head.length > 24) return undefined;
  return head.toLowerCase() === "hub" ? undefined : head;
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

  // Pass 1 — one state per named agent, plus the identity index. A dispatch
  // only *starts* agents, so its own "Spawned 3 background agents" result says
  // nothing about finishing; the later `hub` snapshots are the only rows that
  // do, and they override whatever the dispatch implied. Without this a
  // settled spawn result left every agent reading 已完成 while the harness was
  // still reporting them running.
  const states = new Map<string, AgentTaskStepState>();
  // Every `tasks[]` entry, by the name its dispatch asked for: the only place
  // an agent's kind and assignment are stated.
  const dispatched = new Map<string, SubagentRef>();
  // Ids a `hub` call names on its own, gathered before any remap decision: a
  // wait naming both "PluginReview" and "PluginReview-2" is two live agents
  // (an original and its re-spawn), not one agent under two names.
  const waitNamed = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const id of waitIdsFromArgs(message.args)) waitNamed.add(id);
  }
  // Dispatch name -> the id the runtime reported for it, when the harness
  // disambiguated a re-spawn ("PluginReview" -> "PluginReview-2"). One agent,
  // two names; the row shows the runtime one.
  const runtimeIds = new Map<string, string>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool") continue;
    const refs = subagentRefsFromArgs(message.args);
    if (refs.length > 0) {
      const spawned = i >= turnStart && streaming ? "active" : "complete";
      for (const ref of refs) {
        if (!states.has(ref.id)) states.set(ref.id, spawned);
      }
    }
    for (const ref of dispatchRefsFromArgs(message.args)) {
      if (!dispatched.has(ref.id)) dispatched.set(ref.id, ref);
    }
    // A dispatch always precedes the waits that name its agents, so the index
    // is already populated by the time a suffixed id shows up.
    for (const id of waitIdsFromArgs(message.args)) {
      if (dispatched.has(id)) continue;
      const base = id.replace(/-\d+$/, "");
      if (base === id || !dispatched.has(base)) continue;
      // The dispatch name is live in its own right, so the two are separate
      // agents: the suffixed row stands alone rather than replacing the base.
      if (waitNamed.has(base)) continue;
      if (!runtimeIds.has(base)) runtimeIds.set(base, id);
    }
    const snapshot = jobStatesFromResult(message.result);
    if (isCompleteJobsRoster(message)) {
      for (const [id, state] of states) {
        if (state === "active" && !snapshot.has(id)) states.set(id, "complete");
      }
    }
    for (const [id, state] of snapshot) states.set(id, state);
  }

  // Pass 2 — display order: one step per agent, first naming wins.
  const steps: AgentTaskStep[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool") continue;
    // Naming ids is itself proof of delegation (`hub` waits carry a generic
    // "hub ·…" label the name heuristic cannot classify).
    const refs = subagentRefsFromArgs(message.args);
    const declaresTaskList =
      !!message.args &&
      typeof message.args === "object" &&
      Object.prototype.hasOwnProperty.call(message.args, "tasks");
    if (refs.length === 0 && (declaresTaskList || !isSubagentToolLabel(message.text))) continue;

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
    const hasLaterAssistant = messages.slice(i + 1).some((m) => m.role === "assistant");
    const settledTurn = !streaming && (!isCurrentTurn || hasLaterAssistant);

    const info = extractSubagentTaskInfo(message);
    const state = settled ? "complete" : "active";
    if (refs.length === 0) {
      steps.push({
        key: String(message.seq),
        label: info.label,
        state: settledTurn ? "complete" : state,
        subagentType: info.subagentType,
        detail: info.detail,
      });
      continue;
    }
    for (const ref of refs) {
      const runtimeId = runtimeIds.get(ref.id) ?? ref.id;
      if (seen.has(ref.id) || seen.has(runtimeId)) continue;
      seen.add(ref.id);
      seen.add(runtimeId);
      const source = ref.agent && ref.detail ? undefined : resolveDispatch(ref.id, dispatched);
      const reportedState = states.get(runtimeId) ?? states.get(ref.id);
      const finalState = settledTurn
        ? "complete"
        : (reportedState ?? state);
      steps.push({
        key: `${message.seq}:${runtimeId}`,
        label: ref.label && ref.label !== ref.id ? ref.label : runtimeId,
        state: finalState,
        subagentType: ref.agent ?? source?.agent ?? info.subagentType ?? toolHead(message.text),
        detail: ref.detail ?? source?.detail ?? info.detail,
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
function parseTodoFromResult(result: unknown): TodosPayload | null {
  if (!result) return null;
  let parsed = result;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const details = record.details && typeof record.details === "object"
    ? record.details as Record<string, unknown>
    : record;
  const phases = details.phases;
  if (!Array.isArray(phases)) return null;
  const items: TodoItem[] = [];
  for (const phase of phases) {
    if (!phase || typeof phase !== "object") continue;
    const phaseName = typeof (phase as Record<string, unknown>).name === "string"
      ? ((phase as Record<string, unknown>).name as string).trim()
      : typeof (phase as Record<string, unknown>).phase === "string"
        ? ((phase as Record<string, unknown>).phase as string).trim()
        : undefined;
    const tasks = (phase as Record<string, unknown>).tasks;
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      if (!task || typeof task !== "object") continue;
      const t = task as Record<string, unknown>;
      const content = typeof t.content === "string" ? t.content.trim() : "";
      if (!content) continue;
      const rawStatus = typeof t.status === "string" ? t.status.trim().toLowerCase() : "";
      let status: TodoItem["status"] = "pending";
      if (rawStatus === "completed" || rawStatus === "complete" || rawStatus === "done") {
        status = "complete";
      } else if (rawStatus === "in_progress" || rawStatus === "active" || rawStatus === "running") {
        status = "active";
      } else if (rawStatus === "blocked") {
        status = "blocked";
      } else if (rawStatus === "abandoned" || rawStatus === "dropped") {
        status = "dropped";
      }
      const reason = typeof t.blocker === "string" ? t.blocker.trim() : typeof t.reason === "string" ? t.reason.trim() : undefined;
      const detail = typeof t.detail === "string" ? t.detail.trim() : typeof t.description === "string" ? t.description.trim() : undefined;
      items.push({
        content,
        status,
        phase: phaseName || (typeof t.phase === "string" ? t.phase.trim() : undefined),
        reason: reason || undefined,
        detail: detail || undefined,
      });
    }
  }
  if (items.length === 0) return null;
  return { items, replace: true };
}
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
    const payload = parseTodoFromResult(message.result) ?? message.todos;
    if (!payload) continue;
    if (payload.replace) {
      items = payload.items.filter((item: TodoItem) => item.status !== "dropped");
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
          phase: patch.phase ?? existing.phase,
          reason: patch.reason ?? existing.reason,
          detail: patch.detail ?? existing.detail,
        };
      } else if (patch.content) {
        items = [...items, patch];
      }
    }
  }
  return items;
}
