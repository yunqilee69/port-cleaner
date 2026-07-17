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
        <div>
          <p className="brand-kicker">Network operations utility</p>
          <h1>Port Cleaner</h1>
        </div>
      </div>

      <div className="header-controls">
        <div className="system-status" aria-label="System status: live, local machine">
          <span className="status-lamp" aria-hidden="true" />
          <span><strong>Live</strong> · Local machine</span>
        </div>
        <label className="switch-control">
          <span className="switch-copy">
            <strong>Auto-refresh</strong>
            <small>Every 5 seconds</small>
          </span>
          <input
            aria-label="Auto-refresh every five seconds"
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
          {isRefreshing ? "Scanning…" : "Refresh now"}
        </button>
      </div>
    </header>
  );
}
