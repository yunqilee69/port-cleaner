import { useEffect, useRef, useState, type RefObject } from "react";

import { getProcessDetails } from "../api/portCleaner";
import type { PortBinding, ProcessDetails } from "../types/portCleaner";

interface ProcessDetailsPanelProps {
  binding: PortBinding | null;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onTerminate: (binding: PortBinding, trigger: HTMLButtonElement) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

type DetailState =
  | { status: "idle" | "loading" }
  | { status: "ready"; details: ProcessDetails }
  | { status: "error"; message: string };

export function ProcessDetailsPanel({
  binding,
  fallbackFocusRef,
  onClose,
  onTerminate,
  returnFocusRef,
}: ProcessDetailsPanelProps) {
  const [detailState, setDetailState] = useState<DetailState>({ status: "idle" });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const isOpen = binding !== null;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!binding) {
      setDetailState({ status: "idle" });
      return undefined;
    }
    if (!binding.pid || !Number.isInteger(binding.pid) || binding.pid <= 0) {
      setDetailState({ status: "error", message: "Process details are unavailable because this binding has no valid PID." });
      return undefined;
    }

    let cancelled = false;
    setDetailState({ status: "loading" });
    void getProcessDetails(binding.pid)
      .then((details) => {
        if (!cancelled) setDetailState({ status: "ready", details });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [binding?.id, binding?.pid]);

  useEffect(() => {
    if (!isOpen) return undefined;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      const returnTarget = returnFocusRef.current?.isConnected
        ? returnFocusRef.current
        : fallbackFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      }
    };
  }, [binding?.id, fallbackFocusRef, isOpen, returnFocusRef]);

  if (!binding) return null;

  const canTerminate = Boolean(binding.pid && binding.pid > 0 && binding.access === "allowed");

  return (
    <aside className="detail-panel" aria-labelledby="detail-title">
      <div className="detail-header">
        <div>
          <p className="eyebrow">Process inspection</p>
          <h2 id="detail-title">{binding.processName ?? "Unknown process"}</h2>
        </div>
        <button aria-label="Close process details" className="icon-button" onClick={onClose} ref={closeButtonRef} type="button">×</button>
      </div>

      <div className="detail-body">
        <div className="detail-binding-strip">
          <span className={`protocol-badge protocol-badge--${binding.protocol}`}>{binding.protocol.toUpperCase()}</span>
          <code>{binding.localAddress}:{binding.port}</code>
          <span className={`access-badge access-badge--${binding.access}`}>{binding.access}</span>
        </div>

        {detailState.status === "loading" && <div className="panel-loading"><span className="spinner" aria-hidden="true" />Loading process details…</div>}
        {detailState.status === "error" && <div className="panel-error" role="alert"><strong>Details unavailable</strong><p>{detailState.message}</p></div>}
        {detailState.status === "ready" && (
          <dl className="detail-list">
            <div><dt>PID</dt><dd><code>{detailState.details.pid}</code></dd></div>
            <div><dt>User</dt><dd>{detailState.details.userName ?? "Unavailable"}</dd></div>
            <div><dt>Executable path</dt><dd><code className="copy-block">{detailState.details.executablePath ?? "Unavailable"}</code></dd></div>
            <div><dt>Command line</dt><dd><code className="copy-block">{detailState.details.commandLine ?? "Unavailable"}</code></dd></div>
          </dl>
        )}
      </div>

      <div className="detail-actions">
        <button className="secondary-button" onClick={onClose} type="button">Close</button>
        <button className="danger-button" disabled={!canTerminate} onClick={(event) => onTerminate(binding, event.currentTarget)} type="button">Terminate process</button>
      </div>
    </aside>
  );
}
