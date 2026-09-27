import type {
  AfterTurnEvent,
  BeforeTurnEvent,
  BeforeTurnResult,
  Disposer,
  InternalMessageCapture,
  InternalMessageEvent,
  NormalizedRuntimeEvent,
  PromptContribution,
  RuntimeSwitchEvent,
  RuntimeSwitchHooks,
  SessionClosedEvent,
  SessionCreatedEvent,
  SessionHooks,
  SessionRestoredEvent,
  TurnHooks,
} from "@ccgui/plugin-sdk";
import { runAsPlugin } from "./hardening";

const DEFAULT_BEFORE_HOOK_TIMEOUT_MS = 2_000;
const DEFAULT_PROMPT_CONTRIBUTION_MAX_BYTES = 12 * 1024;
/// Largest internal-frame payload the host will ever hide. Mirrors the Rust
/// `MAX_RECORDED_FRAME_BYTES`: a frame the backend refuses to record an
/// identity for must not be hidden live either, or it reappears on reload.
const MAX_INTERNAL_CAPTURE_BYTES = 64 * 1024;

interface RegisteredHooks<T> {
  pluginId: string;
  hooks: T;
  active: boolean;
}

interface ResultOrigin {
  registration: RegisteredHooks<TurnHooks>;
  isCurrent?: () => boolean;
}

export interface RegisteredInternalMessageCapture {
  pluginId: string;
  capture: InternalMessageCapture;
}

export interface CollectedBeforeTurnResult {
  promptContributions: PromptContribution[];
  internalMessageCaptures: RegisteredInternalMessageCapture[];
}

export interface BeforeHookOptions {
  timeoutMs?: number;
}

export interface BeforeTurnOptions extends BeforeHookOptions {
  maxBytes?: number;
}

const sessionRegistrations: Array<RegisteredHooks<SessionHooks>> = [];
const turnRegistrations: Array<RegisteredHooks<TurnHooks>> = [];
const switchRegistrations: Array<RegisteredHooks<RuntimeSwitchHooks>> = [];
const encoder = new TextEncoder();
const confirmedContributions = new WeakSet<PromptContribution>();
const confirmedContributionSources = new WeakSet<PromptContribution>();
const contributionOwners = new WeakMap<PromptContribution, { origin: ResultOrigin; source: PromptContribution }>();
const captureOwners = new WeakMap<RegisteredInternalMessageCapture, ResultOrigin>();

interface HookGeneration {
  generation: number;
  cancel: () => void;
}

const turnGenerations = new Map<string, HookGeneration>();
const switchGenerations = new Map<string, HookGeneration>();

function register<T>(registrations: Array<RegisteredHooks<T>>, pluginId: string, hooks: T): Disposer {
  const entry = { pluginId, hooks, active: true };
  registrations.push(entry);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    entry.active = false;
    const index = registrations.indexOf(entry);
    if (index >= 0) registrations.splice(index, 1);
  };
}

export function registerSessionHooks(pluginId: string, hooks: SessionHooks): Disposer {
  return register(sessionRegistrations, pluginId, hooks);
}

export function registerTurnHooks(pluginId: string, hooks: TurnHooks): Disposer {
  return register(turnRegistrations, pluginId, hooks);
}

export function registerRuntimeSwitchHooks(pluginId: string, hooks: RuntimeSwitchHooks): Disposer {
  return register(switchRegistrations, pluginId, hooks);
}

function reportHookError(pluginId: string, hookName: string, error: unknown): void {
  console.error(`[plugins] ${pluginId} ${hookName} hook failed`, error);
}

function dispatchNonBlocking<T>(
  registrations: Array<RegisteredHooks<T>>,
  hookName: string,
  getHook: (hooks: T) => ((event: never) => void | Promise<void>) | undefined,
  event: unknown,
  isCurrent?: () => boolean,
): void {
  for (const entry of [...registrations]) {
    const { pluginId, hooks } = entry;
    const hook = getHook(hooks);
    if (!hook) continue;
    queueMicrotask(() => {
      if (!entry.active || (isCurrent && !isCurrent())) return;
      try {
        void Promise.resolve(runAsPlugin(() => hook(event as never))).catch((error: unknown) =>
          reportHookError(pluginId, hookName, error),
        );
      } catch (error) {
        reportHookError(pluginId, hookName, error);
      }
    });
  }
}

export function dispatchSessionCreated(event: SessionCreatedEvent): void {
  dispatchNonBlocking(sessionRegistrations, "onCreated", ({ onCreated }) => onCreated, event);
}

export function dispatchSessionRestored(event: SessionRestoredEvent): void {
  dispatchNonBlocking(sessionRegistrations, "onRestored", ({ onRestored }) => onRestored, event);
}

export function dispatchSessionClosed(event: SessionClosedEvent): void {
  dispatchNonBlocking(sessionRegistrations, "onClosed", ({ onClosed }) => onClosed, event);
}

export function dispatchTurnStarted(event: BeforeTurnEvent): void {
  dispatchNonBlocking(turnRegistrations, "onTurnStarted", ({ onTurnStarted }) => onTurnStarted, event);
}

export function dispatchRuntimeEvent(event: NormalizedRuntimeEvent): void {
  dispatchNonBlocking(turnRegistrations, "onRuntimeEvent", ({ onRuntimeEvent }) => onRuntimeEvent, event);
}

export function dispatchAfterTurn(event: AfterTurnEvent): void {
  dispatchNonBlocking(turnRegistrations, "afterTurn", ({ afterTurn }) => afterTurn, event);
}

export function dispatchInternalMessage(capture: RegisteredInternalMessageCapture, event: InternalMessageEvent): void {
  const origin = captureOwners.get(capture);
  if (!origin || !isResultCurrent(origin)) return;
  dispatchNonBlocking(
    turnRegistrations.filter((entry) => entry.pluginId === origin.registration.pluginId),
    "onInternalMessage",
    ({ onInternalMessage }) => onInternalMessage,
    event,
    () => isResultCurrent(origin),
  );
}

export function dispatchAfterSwitch(event: RuntimeSwitchEvent): void {
  dispatchNonBlocking(switchRegistrations, "afterSwitch", ({ afterSwitch }) => afterSwitch, event);
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_BEFORE_HOOK_TIMEOUT_MS;
  return Math.max(0, timeoutMs);
}

function startGeneration(
  generations: Map<string, HookGeneration>,
  key: string,
): { generation: number; invalidated: Promise<void> } {
  const previous = generations.get(key);
  previous?.cancel();
  const invalidation = Promise.withResolvers<void>();
  const generation = (previous?.generation ?? 0) + 1;
  generations.set(key, { generation, cancel: invalidation.resolve });
  return { generation, invalidated: invalidation.promise };
}

function releaseGeneration(
  generations: Map<string, HookGeneration>,
  key: string,
  generation: number,
): boolean {
  if (generations.get(key)?.generation !== generation) return false;
  generations.delete(key);
  return true;
}

async function waitWithDeadline<T>(
  work: Promise<T>,
  invalidated: Promise<void>,
  timeoutMs: number,
): Promise<T | undefined> {
  const timeout = Promise.withResolvers<void>();
  const timer = setTimeout(timeout.resolve, timeoutMs);
  try {
    return await Promise.race([
      work,
      timeout.promise.then(() => undefined),
      invalidated.then(() => undefined),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function collectBeforeTurnContributions(
  event: BeforeTurnEvent,
  options: BeforeTurnOptions = {},
): Promise<CollectedBeforeTurnResult> {
  const key = event.runId;
  const { generation, invalidated } = startGeneration(turnGenerations, key);
  const registrations = [...turnRegistrations];
  const results: Array<{
    registration: RegisteredHooks<TurnHooks>;
    result?: BeforeTurnResult | void;
  }> = registrations.map((registration) => ({ registration }));
  const work = Promise.allSettled(
    registrations.map(async (registration, index) => {
      const { pluginId, hooks } = registration;
      // Bind before the closure: TS drops property narrowing across a closure
      // boundary, so `hooks.beforeTurn` inside the arrow reads as possibly
      // undefined (dispatchNonBlocking binds its hook for the same reason).
      const beforeTurn = hooks.beforeTurn;
      if (!registration.active || !beforeTurn) return;
      try {
        results[index].result = await runAsPlugin(() => beforeTurn(event));
      } catch (error) {
        reportHookError(pluginId, "beforeTurn", error);
      }
    }),
  );
  await waitWithDeadline(work, invalidated, normalizedTimeout(options.timeoutMs));
  if (!releaseGeneration(turnGenerations, key, generation)) {
    return { promptContributions: [], internalMessageCaptures: [] };
  }

  const promptContributions: PromptContribution[] = [];
  const internalMessageCaptures: RegisteredInternalMessageCapture[] = [];
  const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_PROMPT_CONTRIBUTION_MAX_BYTES);
  let usedBytes = 0;
  for (const { registration, result } of results) {
    if (!registration.active || !result) continue;
    const origin: ResultOrigin = { registration, isCurrent: result.isCurrent };
    if (!isResultCurrent(origin)) continue;
    if (result.internalMessageCapture) {
      const capture = result.internalMessageCapture;
      // A plugin's declared budget is untrusted input: an unbounded value lets
      // one unterminated opening tag hold a whole turn's output, and anything
      // past the host ceiling would be hidden live but visible on reload.
      // Non-finite collapses to 0 — nothing is hidden the host cannot record.
      const declared = capture.maxBytes;
      const registeredCapture: RegisteredInternalMessageCapture = {
        pluginId: registration.pluginId,
        capture: {
          ...capture,
          maxBytes: Number.isFinite(declared) ? Math.min(MAX_INTERNAL_CAPTURE_BYTES, Math.max(0, declared)) : 0,
        },
      };
      captureOwners.set(registeredCapture, origin);
      internalMessageCaptures.push(registeredCapture);
    }
    for (const contribution of result.promptContributions ?? []) {
      const content = contribution.content;
      const contributionBytes = encoder.encode(content).byteLength;
      if (usedBytes + contributionBytes > maxBytes) continue;
      usedBytes += contributionBytes;
      // A plugin may reuse one source object across registrations or workspaces.
      // Snapshot the admitted fields so rebinding it cannot revive cached work.
      const admitted: PromptContribution = {
        id: contribution.id,
        content,
        placement: contribution.placement,
        visibility: contribution.visibility,
        persistence: contribution.persistence,
        onAccepted: contribution.onAccepted,
      };
      contributionOwners.set(admitted, { origin, source: contribution });
      promptContributions.push(admitted);
    }
  }
  return { promptContributions, internalMessageCaptures };
}

function isResultCurrent(origin: ResultOrigin): boolean {
  if (!origin.registration.active) return false;
  try {
    return origin.isCurrent ? runAsPlugin(origin.isCurrent) === true : true;
  } catch (error) {
    reportHookError(origin.registration.pluginId, "beforeTurn.isCurrent", error);
    return false;
  }
}

/** Recheck capture ownership during registration, parsing, and delivery. */
export function isInternalMessageCaptureActive(capture: RegisteredInternalMessageCapture): boolean {
  const origin = captureOwners.get(capture);
  return origin !== undefined && isResultCurrent(origin);
}

/** A reloaded plugin is a new owner; it cannot revive its old session prompts. */
export function isPromptContributionActive(contribution: PromptContribution): boolean {
  const owner = contributionOwners.get(contribution);
  return owner !== undefined && isResultCurrent(owner.origin);
}

/** Host-only provenance used to retire one plugin without stopping its peers. */
export function promptContributionOwner(contribution: PromptContribution): string | undefined {
  return contributionOwners.get(contribution)?.origin.registration.pluginId;
}

export function isPromptContributionConfirmed(contribution: PromptContribution): boolean {
  return confirmedContributions.has(contribution);
}

/** Commit contributions after the engine accepts the launch carrying them.
 * Idempotent because session-scoped contributions may be re-injected later. */
export function confirmPromptContributions(contributions: PromptContribution[]): void {
  for (const contribution of contributions) {
    const owner = contributionOwners.get(contribution);
    // Ownerless contributions are host-authored withdrawal notices, not plugin hooks.
    if ((owner && !isResultCurrent(owner.origin)) || confirmedContributions.has(contribution)) continue;
    confirmedContributions.add(contribution);
    if (owner) {
      if (confirmedContributionSources.has(owner.source)) continue;
      confirmedContributionSources.add(owner.source);
    }
    try {
      runAsPlugin(() => contribution.onAccepted?.());
    } catch (error) {
      reportHookError("host", "promptContribution.onAccepted", error);
    }
  }
}

export async function runBeforeSwitch(
  event: RuntimeSwitchEvent,
  options: BeforeHookOptions = {},
): Promise<void> {
  const key = `${event.switchId}:${event.sourceEngine}->${event.targetEngine}@${event.workspace.id}`;
  const { generation, invalidated } = startGeneration(switchGenerations, key);
  const work = Promise.all(
    [...switchRegistrations].map(async (registration) => {
      const { pluginId, hooks } = registration;
      // Same closure-narrowing bind as collectBeforeTurnContributions above.
      const beforeSwitch = hooks.beforeSwitch;
      if (!registration.active || !beforeSwitch) return;
      try {
        await runAsPlugin(() => beforeSwitch(event));
      } catch (error) {
        reportHookError(pluginId, "beforeSwitch", error);
      }
    }),
  );
  await waitWithDeadline(work, invalidated, normalizedTimeout(options.timeoutMs));
  releaseGeneration(switchGenerations, key, generation);
}
