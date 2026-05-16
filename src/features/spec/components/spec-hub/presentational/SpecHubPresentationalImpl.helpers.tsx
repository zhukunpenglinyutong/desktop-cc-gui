// @ts-nocheck
// Helpers extracted from SpecHubPresentationalImpl.tsx (de-minified bundle).
// Original file was a 25-line minified @ts-nocheck blob; prettier-deminified to 7025 lines
// then helpers split out as sibling module to reduce main file size for large-file gate.
// Identifier names match the minified bundle (single-letter / short) to keep diff minimal.

import { jsx as t } from "react/jsx-runtime";
import di from "lucide-react/dist/esm/icons/archive";
import Wt from "lucide-react/dist/esm/icons/arrow-right-circle";
import mi from "lucide-react/dist/esm/icons/badge-check";
import hi from "lucide-react/dist/esm/icons/check-circle-2";
import Rn from "lucide-react/dist/esm/icons/circle-dashed";
import Yt from "lucide-react/dist/esm/icons/file-pen-line";
import Ln from "lucide-react/dist/esm/icons/shield-check";
import xe from "lucide-react/dist/esm/icons/triangle-alert";
import Se from "lucide-react/dist/esm/icons/wrench";
import {
  getWorkspaceFiles as Dn,
  listExternalSpecTree as Rc,
} from "../../../../../services/tauri";
import {
  isAbsoluteSpecRootInput as jc,
  normalizeSpecRootInput as Ci,
} from "../../../../../lib/spec-core/pathUtils";

export const Mn = ["kickoff", "agent", "refresh"],
  Vc = /^Archive preflight failed:/i,
  Uc = [
    /Strict verify must pass before archive/i,
    /Required tasks are incomplete/i,
    /Change is already archived/i,
    /Select a change first/i,
  ],
  Wc = [
    /^Archive preflight failed:/im,
    /MODIFIED failed for header/i,
    /RENAMED failed for header/i,
    /target spec does not exist/i,
    /only ADDED requirements are allowed/i,
    /Requirement must contain SHALL or MUST keyword/i,
    /requirement missing in .* -> /i,
  ],
  Yc = [
    /no (new|additional|further) (suggestion|change|task|step)/i,
    /no actionable guidance/i,
    /nothing to (update|do|apply)/i,
    /already (up to date|complete|satisfied)/i,
    /无新增建议|没有新增建议|无需更新|无可执行建议|无需新增操作/,
  ],
  qc = ["project_context", "rules", "dependencies"],
  rt = 420,
  de = 12,
  Ni = de + 24,
  On = 108,
  Xc = 56,
  Kc = 220,
  Jc = 24,
  zn = 6,
  xi = 8 * 1024 * 1024,
  Zc = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"],
  Qc = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
  ],
  er = 1,
  tr = 600 * 1e3,
  sr = /^(\d{4}-\d{2}-\d{2})-.+/,
  nr = {
    status: "idle",
    phase: "idle",
    executor: null,
    startedAt: null,
    finishedAt: null,
    instructionsOutput: "",
    executionOutput: "",
    summary: "",
    changedFiles: [],
    tests: [],
    checks: [],
    completedTaskIndices: [],
    noChanges: !1,
    error: null,
    logs: [],
  },
  Bn = {
    status: "idle",
    phase: "idle",
    mode: null,
    targetChangeId: null,
    executor: null,
    startedAt: null,
    finishedAt: null,
    streamOutput: "",
    finalOutput: "",
    summary: "",
    error: null,
    preflightBlockers: [],
    preflightHints: [],
    logs: [],
  },
  Si = {
    status: "idle",
    phase: "idle",
    executor: null,
    startedAt: null,
    finishedAt: null,
    streamOutput: "",
    finalOutput: "",
    summary: "",
    error: null,
    logs: [],
    validateSkipped: !1,
  },
  _n = {
    status: "idle",
    phase: "idle",
    executor: null,
    startedAt: null,
    finishedAt: null,
    streamOutput: "",
    summary: "",
    finalOutput: "",
    error: null,
    logs: [],
  },
  Gn = {
    status: "idle",
    phase: "idle",
    executor: null,
    startedAt: null,
    finishedAt: null,
    streamOutput: "",
    summary: "",
    changedFiles: [],
    tests: [],
    checks: [],
    completedTaskIndices: [],
    error: null,
    logs: [],
  };
export function wi(a, i) {
  const c = new Map(),
    u = [];
  a.forEach((e) => {
    const g = e.id.match(sr);
    if (!g?.[1]) {
      u.push(e);
      return;
    }
    const N = g[1],
      G = c.get(N);
    if (G) {
      G.push(e);
      return;
    }
    c.set(N, [e]);
  });
  const k = [...c.entries()]
    .sort(([e], [g]) => g.localeCompare(e))
    .map(([e, g]) => ({
      key: `date:${e}`,
      label: e,
      kind: "date",
      changes: g,
    }));
  return u.length === 0
    ? k
    : [...k, { key: "fallback:other", label: i, kind: "fallback", changes: u }];
}
export function Ee() {
  return typeof window > "u"
    ? { width: 1280, height: 720 }
    : {
        width: Math.max(window.innerWidth, rt + de * 2),
        height: Math.max(window.innerHeight, 360),
      };
}
export function ne(a, i = Ee()) {
  const c = Number.isFinite(a.x) ? a.x : de,
    u = Number.isFinite(a.y) ? a.y : 108,
    k = Math.max(de, i.width - rt - de),
    e = Math.max(de, i.height - 72);
  return { x: Math.min(Math.max(c, de), k), y: Math.min(Math.max(u, de), e) };
}
export function Ge(a = Ee().width) {
  const i = Ee();
  return { x: ne({ x: Math.min(Ni, a - rt - de), y: On }, i).x, y: On };
}
export function jn(a, i = Ee()) {
  const c = Math.max(1, Math.floor(a)),
    u = ne({ x: Ni, y: On }, i);
  if (c === 1) return [u];
  const k = Math.max(de, i.width - rt - de),
    e = c - 1,
    g = Math.max(0, k - u.x),
    N = Math.floor(g / e - rt),
    G = N >= Jc ? rt + Math.min(Xc, N) : Math.max(Kc, Math.floor(g / e));
  return Array.from({ length: c }, (Z, y) => ne({ x: u.x + G * y, y: u.y }, i));
}
export function Vn(a) {
  return a === "codex" || a === "claude" || a === "opencode";
}
export const Ei = {
    draft: { icon: Yt, className: "is-draft text-[color-mix(in_srgb,var(--status-warning,var(--warning))_92%,var(--text-primary)_8%)]" },
    ready: { icon: hi, className: "is-ready text-[color-mix(in_srgb,var(--status-success,var(--success))_93%,var(--text-primary)_7%)]" },
    implementing: { icon: Se, className: "is-implementing text-[color-mix(in_srgb,var(--info,#2563eb)_92%,var(--text-primary)_8%)] dark:text-[color-mix(in_srgb,var(--info,#7a9dcc)_94%,#dbeafe_6%)]" },
    verified: { icon: Ln, className: "is-verified text-[color-mix(in_srgb,var(--status-success,var(--success))_90%,var(--text-primary)_10%)]" },
    archived: { icon: di, className: "is-archived text-[color-mix(in_srgb,var(--text-muted)_68%,var(--text-primary)_32%)]" },
    blocked: { icon: xe, className: "is-blocked text-[color-mix(in_srgb,var(--status-error,var(--danger))_92%,var(--text-primary)_8%)]" },
  },
  Pi = { continue: Wt, apply: Rn, verify: mi, archive: di, bootstrap: Se },
  ar = {
    full: "specHub.supportFull",
    minimal: "specHub.supportMinimal",
    none: "specHub.supportNone",
  },
  ir = {
    "No workspace selected.": "specHub.runtime.noWorkspaceSelected",
    "Select a workspace first.": "specHub.runtime.selectWorkspaceFirst",
    "No supported spec provider detected.":
      "specHub.runtime.noSupportedProvider",
    "Open a workspace with OpenSpec or spec-kit structure.":
      "specHub.runtime.openSupportedWorkspace",
    "Install Node.js 18+ and make sure `node` is available in PATH.":
      "specHub.runtime.installNode",
    "Managed mode: install OpenSpec CLI, then click Refresh to re-run Doctor.":
      "specHub.runtime.managedInstallOpenSpec",
    "Fallback: switch to BYO mode to use your existing environment settings.":
      "specHub.runtime.fallbackByo",
    "BYO mode: expose `openspec` in PATH and verify `openspec --version` works.":
      "specHub.runtime.byoExposeOpenSpec",
    "Spec-Kit CLI is optional in minimal mode, but enabling it improves diagnostics.":
      "specHub.runtime.speckitOptional",
    "No supported spec workspace detected.":
      "specHub.runtime.noSupportedWorkspace",
    "Spec-Kit is currently in minimal compatibility mode.":
      "specHub.runtime.speckitMinimalMode",
    "No active changes found under openspec/changes.":
      "specHub.runtime.noActiveChanges",
    "This provider is running in minimal compatibility mode.":
      "specHub.runtime.providerMinimalMode",
    "Missing proposal.md": "specHub.runtime.missingProposal",
    "Missing design.md": "specHub.runtime.missingDesign",
    "Missing tasks.md": "specHub.runtime.missingTasks",
    "Missing specs delta": "specHub.runtime.missingSpecsDelta",
    "Run continue first to generate specs delta":
      "specHub.runtime.runContinueFirstForSpecs",
    "Unable to read tasks.md": "specHub.runtime.unableReadTasks",
    "tasks.md is required": "specHub.runtime.tasksRequired",
    "Core artifacts are incomplete": "specHub.runtime.coreArtifactsIncomplete",
    "Change must be verified first":
      "specHub.runtime.changeMustBeVerifiedFirst",
    "Strict verify must pass before archive":
      "specHub.runtime.strictVerifyBeforeArchive",
    "Change is already archived": "specHub.runtime.changeAlreadyArchived",
    "Required tasks are incomplete": "specHub.runtime.requiredTasksIncomplete",
    "Task checkbox not found": "specHub.runtime.taskCheckboxNotFound",
    "Doctor checks passed": "specHub.runtime.doctorChecksPassed",
    "Environment needs attention": "specHub.runtime.environmentNeedsAttention",
    "Select a change first": "specHub.runtime.selectChangeFirst",
    "Core artifacts ready": "specHub.runtime.coreArtifactsReady",
    "Core artifacts incomplete": "specHub.runtime.coreArtifactsIncomplete",
    "No strict verify run in this session": "specHub.runtime.noStrictVerify",
    "No strict verify evidence recorded": "specHub.runtime.noStrictVerify",
    "Latest strict verify passed": "specHub.runtime.latestStrictVerifyPassed",
    "Latest strict verify failed": "specHub.runtime.latestStrictVerifyFailed",
    "Open the target file and fix the requirement mismatch before re-running verify.":
      "specHub.runtime.validationFixHint",
    "Read command output and complete missing artifacts, then run verify again.":
      "specHub.runtime.validationReadOutputHint",
    "OpenSpec instructions captured.":
      "specHub.runtime.openspecInstructionsCaptured",
    "Continue brief attached to apply execution prompt.":
      "specHub.runtime.continueBriefAttached",
    "Guidance generated successfully.":
      "specHub.runtime.guidanceGeneratedSuccessfully",
    "Failed to generate guidance.": "specHub.runtime.failedGenerateGuidance",
    "Failed to generate apply instructions.":
      "specHub.runtime.failedGenerateApplyInstructions",
    "Timed out waiting for apply execution.":
      "specHub.runtime.timedOutWaitingApplyExecution",
    "Apply execution failed.": "specHub.runtime.applyExecutionFailed",
    "No thread id returned, fallback to sync execution.":
      "specHub.runtime.noThreadFallbackSyncExecution",
    "Agent execution finished.": "specHub.runtime.agentExecutionFinished",
    "Refreshing runtime state.": "specHub.runtime.refreshingRuntimeState",
    "Execution finished with no code changes.":
      "specHub.runtime.executionFinishedNoCodeChanges",
    "OpenSpec bootstrap failed": "specHub.runtime.openSpecBootstrapFailed",
    validation: "specHub.runtime.validationTarget",
    "not found": "specHub.runtime.notFound",
    "node not found": "specHub.runtime.nodeNotFound",
    "openspec not found": "specHub.runtime.openspecNotFound",
    "spec-kit not found": "specHub.runtime.speckitNotFound",
  };
export function Ls(a, i) {
  return a === "openspec"
    ? "OpenSpec"
    : a === "speckit"
    ? "Spec-Kit"
    : i("specHub.providerUnknown");
}
export function or(a, i) {
  return i(ar[a]);
}
export function V(a, i) {
  const c = ir[a];
  if (c) return i(c);
  const u = a.match(
    /^Archive preflight failed: delta ([A-Z/]+) requires existing (openspec[\\/]+specs[\\/]+.+)$/i
  );
  if (u) {
    const [, Q, S] = u;
    return i("specHub.runtime.archivePreflightMissingTarget", {
      operations: Q,
      path: S,
    });
  }
  const k = a.match(
    /^Archive preflight failed: delta ([A-Z]+) requirement missing in (openspec[\\/]+specs[\\/]+.+?) -> (.+)$/i
  );
  if (k) {
    const [, Q, S, Ae] = k;
    return i("specHub.runtime.archivePreflightMissingRequirement", {
      operation: Q,
      path: S,
      requirement: Ae,
    });
  }
  const e = a.match(
    /^(Node\.js|OpenSpec CLI|Spec-Kit CLI) is required for (\w+) workflow\.$/i
  );
  if (e) {
    const [, Q, S] = e,
      Ae = i(
        Q === "Node.js"
          ? "specHub.check.node"
          : Q === "OpenSpec CLI"
          ? "specHub.check.openspec"
          : "specHub.check.speckit"
      );
    return i("specHub.runtime.requiredForWorkflow", {
      tool: Ae,
      provider: Ls(S.toLowerCase(), i),
    });
  }
  const g = a.match(/^(\w+)\s\((full|minimal|none)\)$/i);
  if (g) {
    const [, Q, S] = g;
    return i("specHub.runtime.providerSupport", {
      provider: Ls(Q.toLowerCase(), i),
      support: or(S.toLowerCase(), i),
    });
  }
  const N = a.match(/^Detected related git ref: ([0-9a-f]{7,40})$/i);
  if (N) return i("specHub.runtime.gitRefDetected", { ref: N[1] });
  const G = a.match(
    /^Artifact evidence is truncated \((.+)\)\. Re-read before archive\.$/i
  );
  if (G?.[1])
    return i("specHub.runtime.truncatedArtifactEvidence", { artifacts: G[1] });
  const Z = a.match(
    /^Provider mismatch: native action requires openspec, got (\w+)$/i
  );
  if (Z?.[1])
    return i("specHub.runtime.providerMismatchNativeAction", {
      provider: Ls(Z[1].toLowerCase(), i),
    });
  const y = a.match(/^Dispatching execution to (\w+)\.$/i);
  if (y?.[1])
    return i("specHub.runtime.dispatchingExecution", { executor: y[1] });
  const ae = a.match(/^Bound promoted thread (.+)\.$/i);
  if (ae?.[1])
    return i("specHub.runtime.boundPromotedThread", { threadId: ae[1] });
  const Jt = a.match(/^Tool started: (.+)$/i);
  if (Jt?.[1])
    return i("specHub.runtime.executionToolStarted", { tool: Jt[1] });
  const ut = a.match(/^Tool completed: (.+)$/i);
  if (ut?.[1])
    return i("specHub.runtime.executionToolCompleted", { tool: ut[1] });
  const Zt = a.match(/^Execution heartbeat (\d+)s\.$/i);
  if (Zt?.[1])
    return i("specHub.runtime.executionHeartbeat", { seconds: Zt[1] });
  const pt = a.match(/^Execution running\.\.\. (\d+)s$/i);
  if (pt?.[1])
    return i("specHub.runtime.executionRunningSync", { seconds: pt[1] });
  const dt = a.match(/^Execution thread created: (.+)$/i);
  if (dt?.[1])
    return i("specHub.runtime.executionThreadCreated", { threadId: dt[1] });
  const Pe = a.match(
    /^Skipped unmatched task ids from execution output \(invalid indices: (\d+)\)\. invalid refs: (.+)\.$/i
  );
  if (Pe?.[1] && Pe[2])
    return i("specHub.runtime.skippedUnmatchedTaskIdsWithRefs", {
      count: Number(Pe[1]),
      refs: Pe[2],
    });
  const ke = a.match(
    /^Skipped unmatched task ids from execution output \(invalid indices: (\d+)\)\.$/i
  );
  if (ke?.[1])
    return i("specHub.runtime.skippedUnmatchedTaskIds", {
      count: Number(ke[1]),
    });
  const Qt = a.match(/^Writing (\d+) completed task\(s\) to tasks\.md\.$/i);
  if (Qt?.[1])
    return i("specHub.runtime.writingCompletedTasksToTasks", {
      count: Number(Qt[1]),
    });
  const ye = a.match(/^apply (guidance|execute) started with (\w+)$/i);
  if (ye?.[1] && ye[2])
    return i("specHub.runtime.applyStartedWith", {
      mode: ye[1],
      executor: ye[2],
    });
  const es = a.match(/^Auto-marked (\d+) task\(s\) as completed\.$/i);
  if (es?.[1])
    return i("specHub.runtime.autoMarkedTasks", { count: Number(es[1]) });
  const $e = a.match(/^Execution finished with (\d+) changed file\(s\)\.$/i);
  if ($e?.[1])
    return i("specHub.runtime.executionFinishedChangedFiles", {
      count: Number($e[1]),
    });
  const mt = a.match(/^Task write-back failed: (.+)$/i);
  if (mt?.[1])
    return i("specHub.runtime.taskWritebackFailed", { reason: mt[1] });
  const ht = a.match(/^Next: (.+)$/i);
  return ht?.[1] ? i("specHub.runtime.nextSteps", { steps: ht[1] }) : a;
}
export function cr(a, i) {
  const c = a.match(/^(\[[^\]]+\]\s+\[[^\]]+\]\s+)([\s\S]+)$/);
  return c ? `${c[1]}${V(c[2], i)}` : V(a, i);
}
export function rr(a, i, c) {
  const u = a.split("/").filter(Boolean);
  return u.length >= 2
    ? u[u.length - 2] || c("specHub.specFileFallback", { index: i + 1 })
    : u[u.length - 1] || c("specHub.specFileFallback", { index: i + 1 });
}
export function lr(a, i) {
  return i === "openspec" || a.length > 25 ? "legacy" : "new";
}
export function je(a) {
  return typeof a != "string" ? "" : a.trim();
}
export function ur(a) {
  const i = a.payload,
    c = je(i.projectType).toLowerCase(),
    u = i.keyCommands,
    k = Array.isArray(u)
      ? u.map((e) => je(e)).filter(Boolean).join(`
`)
      : je(u);
  return {
    projectType: c === "new" || c === "legacy" ? c : lr(a.files, a.provider),
    domain: je(i.domain),
    architecture: je(i.architecture),
    constraints: je(i.constraints),
    keyCommands: k,
    owners: je(i.owners),
    summary: je(i.summary) || "Generated by selected agent",
  };
}
export function Un(a) {
  const i = a.trim();
  if (!i) return null;
  const c = i.indexOf("{"),
    u = i.lastIndexOf("}");
  if (c < 0 || u < 0 || u <= c) return null;
  try {
    return JSON.parse(i.slice(c, u + 1));
  } catch {
    return null;
  }
}
export function pr(a) {
  const i = [...new Set(a.directories.map((k) => k.split("/")[0] || k))]
      .filter(Boolean)
      .slice(0, 16),
    c = a.files.slice(0, 40);
  return [
    "You are generating OpenSpec project context.",
    "Return ONLY valid JSON with keys:",
    "projectType, domain, architecture, constraints, keyCommands, owners, summary",
    "Rules:",
    '- projectType must be "legacy" or "new".',
    "- keyCommands should be an array of shell command strings.",
    "- Keep content concise, practical, and repository-specific.",
    "",
    `Workspace: ${a.workspaceName?.trim() || "current-workspace"}`,
    `Detected provider: ${a.provider}`,
    `Top-level directories: ${i.join(", ") || "N/A"}`,
    `Sample files: ${c.join(", ") || "N/A"}`,
  ].join(`
`);
}
export function q(a) {
  return a === "claude"
    ? "Claude Code"
    : a === "opencode"
    ? "OpenCode"
    : "Codex";
}
export const $i = ["codex", "claude", "opencode"],
  dr = 3;
export function mr(a) {
  const i = a.trim().toLowerCase();
  return Zc.some((c) => i.endsWith(c));
}
export function hr(a) {
  return a.match(/^data:([^;,]+)[;,]/i)?.[1]?.toLowerCase() ?? "";
}
export function br(a) {
  const i = a.indexOf(",");
  if (i < 0) return 0;
  const c = a.slice(i + 1).trim();
  if (!c) return 0;
  const u = c.endsWith("==") ? 2 : c.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((c.length * 3) / 4) - u);
}
export function Ri(a) {
  if (a < 1024) return `${a} B`;
  const i = a / 1024;
  return i < 1024 ? `${i.toFixed(1)} KB` : `${(i / 1024).toFixed(1)} MB`;
}
export function gr(a, i) {
  if (a.startsWith("data:")) return `pasted-image-${i + 1}`;
  const c = a.replace(/\\/g, "/").trim(),
    u = c.split("/").filter(Boolean);
  return u[u.length - 1] ?? c;
}
export function fr(a) {
  switch (a) {
    case "continue":
      return "openspec instructions specs --change '<change-id>'";
    case "apply":
      return "openspec instructions tasks --change '<change-id>'";
    case "verify":
      return "openspec validate '<change-id>' --strict";
    case "archive":
      return "openspec archive '<change-id>' --yes";
    default:
      return "openspec --help";
  }
}
export function vr(a) {
  return jc(a);
}
export function kr(a) {
  const i = a.workspaceName?.trim() || "current-workspace",
    c =
      a.blockers.length > 0
        ? a.blockers.map((k) => `- ${k}`).join(`
`)
        : "- none",
    u =
      a.latestArchiveOutput?.trim() ||
      "(no archive output captured in timeline)";
  return [
    "You are an OpenSpec archive-unblock agent.",
    "Goal: make this change archivable by fixing spec delta compatibility only.",
    "",
    `Workspace: ${i}`,
    `Change: ${a.changeId}`,
    `Spec root: ${a.specRoot}`,
    "",
    "Observed blockers:",
    c,
    "",
    "Latest archive output:",
    u,
    "",
    "Must-do steps:",
    "1) Inspect openspec/changes/<change>/specs/*.md versus openspec/specs/* targets.",
    "2) Resolve MODIFIED/RENAMED header mismatches by editing change deltas to valid operations (e.g., ADDED when target header is absent).",
    `3) Run: openspec validate ${a.changeId} --strict`,
    "4) Do NOT run archive command.",
    "",
    "Return:",
    "- changed files",
    "- why each change is needed",
    "- final validate result",
  ].join(`
`);
}
export function yr(a) {
  const i = a.workspaceName?.trim() || "current-workspace",
    c =
      a.mode === "create"
        ? [
            "Goal:",
            "- Create a new OpenSpec change under openspec/changes.",
            "- Create or update proposal/design/tasks artifacts as needed for this request.",
            "- Pick a clear, kebab-case change id.",
          ].join(`
`)
        : [
            "Goal:",
            `- Append and refine proposal content for existing change: ${
              a.targetChangeId ?? "<missing-change-id>"
            }.`,
            "- Update proposal.md while preserving existing sections and intent.",
            "- If related tasks/spec updates are needed, update them in the same change.",
          ].join(`
`);
  return [
    "You are an OpenSpec proposal assistant.",
    "",
    `Workspace: ${i}`,
    `Spec root: ${a.specRoot}`,
    `Mode: ${a.mode}`,
    c,
    "",
    "User request:",
    a.content.trim(),
    "",
    "Attachment context:",
    a.attachments.length > 0
      ? [
          `${a.attachments.length} image attachment(s) are included with this request.`,
          "Use uploaded images as additional context when drafting proposal updates.",
          ...a.attachments
            .slice(0, 6)
            .map((u, k) => `- image[${k + 1}]: ${gr(u, k)}`),
        ].join(`
`)
      : "No image attachments.",
    "",
    "Execution rules:",
    "- Use full-access tools and edit files directly in this workspace.",
    "- Keep structure clear and concise; avoid duplication.",
    "- Return JSON only, no markdown fence.",
    "",
    "Return schema:",
    "{",
    '  "summary": "one-line summary",',
    '  "change_id": "change-id-if-known",',
    '  "updated_files": ["relative/path.md"]',
    "}",
  ].join(`
`);
}
export function Ar(a) {
  const i = a.workspaceName?.trim() || "current-workspace",
    c = `openspec/changes/${a.changeId}/verification.md`;
  return [
    "You are an OpenSpec verification completion assistant.",
    "",
    `Workspace: ${i}`,
    `Change: ${a.changeId}`,
    `Spec root: ${a.specRoot}`,
    "",
    "Goal:",
    `- Create or update ${c} with verification evidence for this change before strict validate.`,
    "",
    "Must-do steps:",
    "1) Read proposal/design/tasks/specs under this change and gather current implementation evidence.",
    "2) Write verification.md with concise sections: Scope, Checks Run, Results, Risks/Follow-ups.",
    "3) Do NOT fabricate command output; if evidence is missing, mark TODO explicitly.",
    "4) Keep content factual and directly useful for reviewers.",
    "",
    "Return JSON only:",
    "{",
    '  "summary": "one-line summary",',
    `  "verification_path": "${c}"`,
    "}",
  ].join(`
`);
}
export function Kt(a) {
  return typeof a == "string" ? a.trim() : "";
}
export function Is(a) {
  return Array.isArray(a)
    ? a.map((i) => (typeof i == "string" ? i.trim() : "")).filter(Boolean)
    : [];
}
export function Hr(a) {
  const i = a.trim().toLowerCase();
  return i === "apply" ||
    i === "verify" ||
    i === "archive" ||
    i === "manual-review"
    ? i
    : null;
}
export function Tr(a) {
  return [
    "You are an OpenSpec planning assistant.",
    "This is a READ-ONLY analysis task.",
    "Do NOT edit files, do NOT update tasks, do NOT run write operations.",
    "",
    `Workspace: ${a.workspaceName?.trim() || "current-workspace"}`,
    `Change: ${a.changeId}`,
    `Spec root: ${a.specRoot}`,
    "",
    "OpenSpec continue output:",
    a.continueOutput.trim() || "(empty)",
    "",
    "Return JSON only with this schema:",
    "{",
    '  "summary": "one-line summary",',
    '  "recommended_next_action": "apply|verify|archive|manual-review",',
    '  "suggested_scope": ["relative/path-or-artifact"],',
    '  "risks": ["risk item"],',
    '  "verification_plan": ["verification step"],',
    '  "execution_sequence": ["step 1", "step 2"]',
    "}",
  ].join(`
`);
}
export function Cr(a, i) {
  const c = Un(a),
    u = Kt(c?.summary) || Kt(c?.result) || Kt(c?.message),
    k = Hr(Kt(c?.recommended_next_action) || Kt(c?.recommendedNextAction)),
    e = Is(c?.suggested_scope ?? c?.suggestedScope),
    g = Is(c?.risks),
    N = Is(c?.verification_plan ?? c?.verificationPlan),
    G = Is(c?.execution_sequence ?? c?.executionSequence);
  return {
    summary: u || "Continue guidance analyzed.",
    recommendedNextAction: k,
    suggestedScope: e,
    risks: g,
    verificationPlan: N,
    executionSequence: G,
    generatedAt: i.generatedAt,
    rawOutput: a.trim(),
    changeId: i.changeId,
    specRoot: i.specRoot,
  };
}
export function Nr(a, i, c) {
  return a === "apply" &&
    i.some((u) => u.includes("Run continue first to generate specs delta"))
    ? c("specHub.nextStep.runContinueFirst")
    : (a === "verify" || a === "archive") &&
      i.some((u) =>
        [
          "Core artifacts are incomplete",
          "Missing design.md",
          "Missing tasks.md",
          "Missing specs delta",
        ].includes(u)
      )
    ? c("specHub.nextStep.runContinueThenApply")
    : null;
}
export function xr(a) {
  return Vc.test(a.trim());
}
export function Sr(a) {
  const i = a.trim();
  return !i || Uc.some((c) => c.test(i)) ? !1 : Wc.some((c) => c.test(i));
}
export function lt(a) {
  const i = Math.max(0, Math.round(a / 1e3)),
    c = Math.floor(i / 60),
    u = i % 60;
  return c > 0 ? `${c}m ${u}s` : `${u}s`;
}
export function Fi(a) {
  const i = a.continuePosition.x + rt + 8,
    c = a.continuePosition.y + 92,
    u = a.applyPosition.x - 8,
    k = a.applyPosition.y + 92,
    e = u - i,
    g = k - c,
    N = Math.hypot(e, g);
  if (!Number.isFinite(N) || N < 24) return null;
  const G = (Math.atan2(g, e) * 180) / Math.PI;
  return { left: i, top: c, width: N, angle: G };
}
export async function Li(a) {
  const i = Ci(a.customSpecRoot ?? null),
    u = (i ? await Rc(a.workspaceId, i) : await Dn(a.workspaceId)).files ?? [],
    k = `openspec/changes/${a.changeId}`,
    e = `${k}/proposal.md`,
    g = `${k}/design.md`,
    N = `${k}/tasks.md`,
    G = `${k}/verification.md`,
    Z = u
      .filter((y) => y.startsWith(`${k}/specs/`) && y.endsWith(".md"))
      .sort((y, ae) => y.localeCompare(ae));
  return {
    proposalPath: e,
    designPath: g,
    tasksPath: N,
    verificationPath: G,
    proposalExists: u.includes(e),
    designExists: u.includes(g),
    tasksExists: u.includes(N),
    verificationExists: u.includes(G),
    specPaths: Z,
    specsExists: Z.length > 0,
  };
}
export function Wn(a) {
  return a === "continue" || a === "apply";
}
export function wr(a) {
  const i = a.trim();
  return i ? Yc.some((c) => c.test(i)) : !0;
}
export function Yn(a, i) {
  const c = new RegExp(`${i}="([^"]+)"`, "i");
  return a.match(c)?.[1]?.trim() ?? null;
}
export function Ii(a) {
  return a
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function Di(a, i = 180) {
  return a.length <= i
    ? a
    : `${a.slice(0, Math.max(0, i - 1)).trimEnd()}\u2026`;
}
export function Er(a) {
  let i = a.trim();
  const c = [];
  if (!i) return { text: "", removedTags: c };
  for (const u of qc) {
    const k = new RegExp(`<${u}[^>]*>[\\s\\S]*?<\\/${u}>`, "ig");
    k.test(i) &&
      (c.push(u),
      (k.lastIndex = 0),
      (i = i.replace(k, `<${u}>...collapsed in compact view...</${u}>`)));
  }
  return (
    (i = i
      .replace(
        /\n{3,}/g,
        `

`
      )
      .trim()),
    { text: i, removedTags: c }
  );
}
export function Pr(a) {
  const i = a.trim();
  if (!i)
    return {
      noSuggestion: !0,
      highlights: [],
      raw: "",
      isTemplate: !1,
      artifactId: null,
      artifactChange: null,
      artifactSchema: null,
      taskText: null,
    };
  const c = i.match(/<artifact\b[^>]*>/i),
    u = i.match(/<task>([\s\S]*?)<\/task>/i);
  if (c) {
    const g = c[0],
      N = Yn(g, "id"),
      G = Yn(g, "change"),
      Z = Yn(g, "schema"),
      y = u ? Ii(u[1] ?? "") : "",
      ae = y ? Di(y) : null;
    return {
      noSuggestion: !1,
      highlights: [],
      raw: i,
      isTemplate: !0,
      artifactId: N,
      artifactChange: G,
      artifactSchema: Z,
      taskText: ae,
    };
  }
  const e = i
    .split(/\r?\n/)
    .map((g) => g.trim())
    .filter(Boolean)
    .filter((g) => !/^(openspec|specify)\b/i.test(g))
    .filter((g) => !/^task status:\s*/i.test(g))
    .filter((g) => !/^specs to update:\s*/i.test(g))
    .filter((g) => !/^<\?xml|^<!DOCTYPE|^<\/?[a-z0-9_-]+/i.test(g))
    .map((g) => Ii(g))
    .filter(Boolean)
    .map((g) => g.replace(/^[-*]\s+/, "").trim())
    .map((g) => Di(g))
    .filter(Boolean)
    .slice(0, 4);
  return {
    noSuggestion: wr(i),
    highlights: e,
    raw: i,
    isTemplate: !1,
    artifactId: null,
    artifactChange: null,
    artifactSchema: null,
    taskText: null,
  };
}
export function Ds(a) {
  if (!a || typeof a != "object") return null;
  const i = a,
    c = i.result ?? void 0,
    u = c?.thread ?? i.thread,
    k = c?.turn ?? i.turn,
    e = [
      c?.threadId,
      c?.thread_id,
      u?.id,
      c?.turnId,
      c?.turn_id,
      k?.id,
      i.threadId,
      i.thread_id,
      i.turnId,
      i.turn_id,
    ];
  for (const g of e) if (typeof g == "string" && g.trim()) return g.trim();
  return null;
}
export function Mi(a) {
  const i = a.result ?? void 0;
  return (
    [
      typeof a.text == "string" ? a.text : "",
      typeof i?.text == "string" ? String(i.text) : "",
      typeof i?.output_text == "string" ? String(i.output_text) : "",
      typeof i?.outputText == "string" ? String(i.outputText) : "",
      typeof i?.content == "string" ? String(i.content) : "",
    ]
      .map((u) => u.trim())
      .find((u) => u.length > 0) ?? ""
  );
}
export function qn(a) {
  const i = a.split(/(`[^`]+`)/g).filter(Boolean);
  return i.length === 0
    ? [a]
    : i.map((c, u) =>
        c.startsWith("`") && c.endsWith("`")
          ? t("code", { children: c.slice(1, -1) }, `task-code-${u}`)
          : t("span", { children: c }, `task-text-${u}`)
      );
}
export function $r(a, i) {
  const c = a.split(/\r?\n/),
    u = new Map();
  i.forEach((g) => {
    u.set(g.lineNumber, g);
  });
  const k = [];
  let e = !1;
  for (let g = 0; g < c.length; g += 1) {
    const N = g + 1,
      G = c[g] ?? "",
      Z = u.get(N);
    if (Z) {
      k.push({ kind: "task", key: `task-${N}`, item: Z }), (e = !0);
      continue;
    }
    const y = G.trim();
    if (!y) {
      k.push({ kind: "blank", key: `blank-${N}` }), (e = !1);
      continue;
    }
    if (e && /^\s{2,}\S/.test(G)) {
      k.push({ kind: "task-note", key: `task-note-${N}`, text: y });
      continue;
    }
    const ae = y.match(/^(#{1,6})\s+(.*)$/);
    if (ae?.[2]) {
      k.push({
        kind: "heading",
        key: `heading-${N}`,
        level: ae[1]?.length ?? 2,
        text: ae[2].trim(),
      }),
        (e = !1);
      continue;
    }
    k.push({ kind: "text", key: `text-${N}`, text: y }), (e = !1);
  }
  return k;
}
