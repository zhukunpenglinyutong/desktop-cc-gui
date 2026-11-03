import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { createPortal } from "react-dom";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { useBrowserOcclusion } from "@/features/browser/occlusion";
import { Input } from "@/components/base/input/input";
import {
  answerGrantRequest,
  currentGrantRequest,
  subscribeGrantDialog,
} from "@/lib/grant";
import {
  answerCredentialConsent,
  currentCredentialConsent,
  subscribeCredentialConsent,
} from "@/lib/credential-consent";
import {
  cancelAppClose,
  closeConfirmPending,
  confirmAppClose,
  subscribeCloseConfirm,
} from "@/lib/close-confirm";

/**
 * Shared shell for the small imperative dialogs below. Built on react-aria's
 * Modal/ModalOverlay/Dialog, which own the a11y contract outright: role +
 * aria-modal, the focus trap, Escape dismissal, outside-press dismissal
 * (`isDismissable`), and portalling to document.body.
 *
 * z-110, not z-50: the portalled overlay is a document.body sibling of
 * the settings shell's z-100 page, so dialogs opened from inside settings
 * (add/edit/delete channel) must outrank it to stay visible.
 */
export function ModalShell({
  children,
  onClose,
  className,
  label,
  dialogClassName,
}: {
  children: ReactNode;
  onClose: () => void;
  /** Panel sizing override; defaults to the compact w-80 prompt size. */
  className?: string;
  /** Accessible title for the dialog (or render a Heading slot="title"). */
  label?: string;
  /** Inner Dialog layout override; needed when className makes the Modal a
   * bounded flex column so children can scroll instead of being clipped. */
  dialogClassName?: string;
}) {
  // ModalShell only renders while open; the browser webview hides so the
  // dialog is not painted under it.
  useBrowserOcclusion(true);
  return (
    <ModalOverlay
      isOpen
      // `isDismissable` belongs on the overlay: react-aria's `useOverlay`
      // defaults it to false and `useModalOverlay` only reads it from the
      // ModalOverlay — on the inner Modal it is silently ignored (the library
      // warns in dev), which left outside-press dismissal dead for every
      // dialog built on this shell.
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-110 flex items-center justify-center bg-overlay-backdrop"
    >
      <Modal
        className={cx(
          "w-80 rounded-2lg border border-border-button-default bg-background-primary-default p-4 shadow-xl outline-none",
          className,
        )}
      >
        <Dialog aria-label={label} className={cx("outline-none", dialogClassName)}>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

interface PromptDialogProps {
  title: string;
  initial?: string;
  /** Helper text under the field. */
  hint?: string;
  placeholder?: string;
  /** Allow submitting the empty string (e.g. clearing an alias). */
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Single-field name prompt (new folder / rename). window.prompt is not
 * reliable inside Tauri's WKWebView, so this is a real modal. */
export function PromptDialog({
  title,
  initial = "",
  hint,
  placeholder,
  allowEmpty = false,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  // The field (not the first button) takes the initial focus, selected so a
  // rename can be typed over directly.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();

  return (
    <ModalShell onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed || allowEmpty) onSubmit(trimmed);
        }}
        className="flex flex-col gap-3"
      >
        <Input
          ref={inputRef}
          label={title}
          hint={hint}
          placeholder={placeholder}
          value={value}
          onChange={setValue}
          size="small"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="small" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="small" disabled={!allowEmpty && !trimmed}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

interface ConfirmDialogProps {
  message: string;
  danger?: boolean;
  /** Override for the confirm button's label when the action needs to be
   *  spelled out (e.g. 一并归档). */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra body content (e.g. the file list of the switch confirmation). */
  children?: ReactNode;
  /** "confirm" (default): Enter confirms. "none": no button takes focus, for
   *  prompts that can open while the user is typing elsewhere (a stray Enter
   *  must not answer them). */
  initialFocus?: "confirm" | "none";
}

export function ConfirmDialog({
  message,
  danger = false,
  confirmLabel,
  onConfirm,
  onCancel,
  children,
  initialFocus = "confirm",
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <ModalShell onClose={onCancel}>
      <p className="text-body-medium text-text-primary">{message}</p>
      {children}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {/* The confirm button takes the dialog's initial focus so Enter
         *  confirms instead of cancelling. */}
        <Button
          variant={danger ? "danger" : "primary"}
          size="small"
          autoFocus={initialFocus === "confirm"}
          onClick={onConfirm}
        >
          {confirmLabel ?? t("common.confirm")}
        </Button>
      </div>
    </ModalShell>
  );
}
interface ConfirmPopoverProps extends ConfirmDialogProps {
  /** Pointer position the popover opens next to. */
  anchor: { x: number; y: number };
}

/** Pointer-anchored ConfirmDialog variant for destructive row actions
 * (session delete): the confirmation surfaces next to the cursor instead of
 * at screen center, so the mouse barely travels. Non-modal — no backdrop;
 * positioning and dismissal (Escape, outside press, blur/resize) mirror the
 * ContextMenu contract. */
export function ConfirmPopover({ message, danger = false, anchor, onConfirm, onCancel }: ConfirmPopoverProps) {
  const { t } = useTranslation();
  useBrowserOcclusion(true);
  const popoverRef = useRef<HTMLDialogElement>(null);
  const [pos, setPos] = useState(anchor);
  // Latest-handler ref so the global dismissal listeners below subscribe
  // once yet always invoke the current onCancel.
  const onCancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    onCancelRef.current = onCancel;
  });

  // Clamp into the viewport once the popover's real size is known; the small
  // offset keeps the cursor from covering the panel edge.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(anchor.x + 4, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(anchor.y + 8, window.innerHeight - rect.height - 8));
    setPos({ x, y });
  }, [anchor]);

  useLayoutEffect(() => {
    const close = () => onCancelRef.current();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  return createPortal(
    <dialog
      open
      ref={popoverRef}
      role="alertdialog"
      aria-label={message}
      className="fixed z-120 m-0 w-72 rounded-2lg border border-border-button-default bg-background-primary-default p-3 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="text-body-medium text-text-primary">{message}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {/* Same focus contract as the modal: Enter confirms. */}
        <Button variant={danger ? "danger" : "primary"} size="small" autoFocus onClick={onConfirm}>
          {t("common.confirm")}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}

/** Renders the on-demand directory-grant prompt driven by lib/grant.ts.
 *  Mounted once at the app root (App.tsx); hidden whenever no file command
 *  is waiting on an outside-roots decision. */
export function GrantAccessDialogHost() {
  const { t } = useTranslation();
  const request = useSyncExternalStore(subscribeGrantDialog, currentGrantRequest);
  if (!request) return null;
  return (
    <ConfirmDialog
      message={t("files.grantAccess", { dir: request.dir })}
      onConfirm={() => answerGrantRequest(true)}
      onCancel={() => answerGrantRequest(false)}
    />
  );
}

/** Renders the CLI-login consent prompt driven by lib/credential-consent.ts.
 *  Mounted once at the app root (App.tsx); shown the first time a plugin's
 *  limits lookup needs a local CLI login, listing every store read and the
 *  only host each credential goes to. */
export function CredentialConsentDialogHost() {
  const { t } = useTranslation();
  const request = useSyncExternalStore(subscribeCredentialConsent, currentCredentialConsent);
  if (!request) return null;
  return (
    <ConfirmDialog
      message={t("plugins.credentialConsent.message")}
      confirmLabel={t("plugins.credentialConsent.allow")}
      // Opens on a plugin's background lookup, possibly mid-typing.
      initialFocus="none"
      onConfirm={() => answerCredentialConsent(true)}
      onCancel={() => answerCredentialConsent(false)}
    >
      <p className="mt-2 text-body-2-regular text-text-secondary">
        {t("plugins.credentialConsent.detail")}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {request.sources.map((source) => (
          <li
            key={`${source.provider}:${source.kind}:${source.location}`}
            className="rounded-lg bg-background-secondary-default px-3 py-2 text-body-2-regular"
          >
            <span className="font-medium text-text-primary">
              {source.provider === "claude" ? "Claude Code" : "Codex"}
            </span>
            <span className="ml-2 break-all font-mono text-text-secondary">
              {source.kind === "keychain"
                ? t("plugins.credentialConsent.keychain", { location: source.location })
                : source.location}
            </span>
            <span className="block text-text-tertiary">
              {t("plugins.credentialConsent.sentTo", { host: source.host })}
            </span>
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

/** Renders the app-close confirmation driven by lib/close-confirm.ts.
 *  Mounted once at the app root (App.tsx); shown when the window close
 *  button is pressed, so one misclick can't kill every running session. */
export function CloseConfirmDialogHost() {
  const { t } = useTranslation();
  const pending = useSyncExternalStore(subscribeCloseConfirm, closeConfirmPending);
  if (!pending) return null;
  return (
    <ConfirmDialog
      danger
      message={t("common.confirmCloseApp")}
      onConfirm={confirmAppClose}
      onCancel={cancelAppClose}
    />
  );
}
