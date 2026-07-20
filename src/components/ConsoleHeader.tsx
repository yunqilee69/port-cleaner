import type { RefObject } from "react";

interface ConsoleHeaderProps {
  autoRefresh: boolean;
  isRefreshing: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  onRefresh: () => void;
  refreshButtonRef: RefObject<HTMLButtonElement | null>;
}

export function ConsoleHeader({
  autoRefresh,
  isRefreshing,
  onAutoRefreshChange,
  onRefresh,
  refreshButtonRef,
}: ConsoleHeaderProps) {
  return (
    <header className="console-header">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>Port Cleaner</h1>
      </div>

      <div className="header-controls">
        <label className="switch-control">
          <span className="switch-copy">
            <strong>自动刷新</strong>
            <small>每 5 秒</small>
          </span>
          <input
            aria-label="每五秒自动刷新"
            checked={autoRefresh}
            onChange={(event) => onAutoRefreshChange(event.target.checked)}
            role="switch"
            type="checkbox"
          />
          <span className="switch-track" aria-hidden="true"><span /></span>
        </label>
        <button
          className="refresh-button"
          disabled={isRefreshing}
          onClick={onRefresh}
          ref={refreshButtonRef}
          type="button"
        >
          <span className={isRefreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">↻</span>
          {isRefreshing ? "扫描中…" : "立即刷新"}
        </button>
      </div>
    </header>
  );
}
