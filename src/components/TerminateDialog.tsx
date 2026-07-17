import { useEffect, useRef, type RefObject } from "react";

import type { PortBinding } from "../types/portCleaner";

interface TerminateDialogProps {
  binding: PortBinding | null;
  error: string | null;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  secondaryReturnFocusRef: RefObject<HTMLElement | null>;
}

export function TerminateDialog({
  binding,
  error,
  fallbackFocusRef,
  isSubmitting,
  onCancel,
  onConfirm,
  returnFocusRef,
  secondaryReturnFocusRef,
}: TerminateDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const isSubmittingRef = useRef(isSubmitting);
  const onCancelRef = useRef(onCancel);
  const isOpen = binding !== null;

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
    onCancelRef.current = onCancel;
  }, [isSubmitting, onCancel]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmittingRef.current) {
        onCancelRef.current();
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      const returnTarget = [
        previouslyFocused,
        returnFocusRef.current,
        secondaryReturnFocusRef.current,
        fallbackFocusRef.current,
      ].find((candidate) => candidate?.isConnected);
      if (returnTarget) {
        returnTarget.focus();
      }
    };
  }, [fallbackFocusRef, isOpen, returnFocusRef, secondaryReturnFocusRef]);

  useEffect(() => {
    if (isOpen && isSubmitting) {
      dialogRef.current?.focus();
    }
  }, [isOpen, isSubmitting]);

  if (!binding) return null;

  return (
    <div className="dialog-backdrop">
      <section aria-describedby="terminate-warning" aria-labelledby="terminate-title" aria-modal="true" className="terminate-dialog" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="warning-emblem" aria-hidden="true">!</div>
        <p className="eyebrow">危险操作</p>
        <h2 id="terminate-title">确认结束进程</h2>
        <p id="terminate-warning" className="dialog-warning">
          正常结束该进程可能中断当前连接，并造成未保存的数据丢失。
        </p>

        <dl className="termination-facts">
          <div><dt>进程</dt><dd>{binding.processName ?? "未知进程"}</dd></div>
          <div><dt>PID</dt><dd><code>{binding.pid ?? "不可用"}</code></dd></div>
          <div><dt>监听端口</dt><dd><span className={`protocol-badge protocol-badge--${binding.protocol}`}>{binding.protocol.toUpperCase()}</span> <code>{binding.localAddress}:{binding.port}</code></dd></div>
        </dl>

        <div className="signal-note"><span aria-hidden="true">i</span><p>Port Cleaner 只发送操作系统的正常结束信号，不会强制结束进程。</p></div>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button className="secondary-button" disabled={isSubmitting} onClick={onCancel} ref={cancelRef} type="button">取消</button>
          <button className="danger-button" disabled={isSubmitting} onClick={onConfirm} type="button">{isSubmitting ? "正在结束进程…" : "确认结束进程"}</button>
        </div>
      </section>
    </div>
  );
}
