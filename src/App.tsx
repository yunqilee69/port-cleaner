import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "./App.css";
import { listPortBindings, terminateProcess } from "./api/portCleaner";
import { BindingTable } from "./components/BindingTable";
import { ConsoleHeader } from "./components/ConsoleHeader";
import {
  FilterBar,
  type AccessFilter,
  type BindingStateFilter,
  type ProtocolFilter,
} from "./components/FilterBar";
import { ProcessDetailsPanel } from "./components/ProcessDetailsPanel";
import { SummaryMetrics } from "./components/SummaryMetrics";
import { TerminateDialog } from "./components/TerminateDialog";
import type { PortBinding } from "./types/portCleaner";

const REFRESH_INTERVAL_MS = 5_000;

type LoadState = "loading" | "ready" | "error";

interface BindingTarget {
  fingerprint: string;
  id: string;
}

function bindingFingerprint(binding: PortBinding): string {
  return [
    binding.protocol,
    binding.localAddress,
    binding.port,
    binding.state,
    binding.pid,
    binding.processName,
    binding.userName,
    binding.access,
  ].join("\u0000");
}

function createBindingTarget(binding: PortBinding): BindingTarget {
  return { fingerprint: bindingFingerprint(binding), id: binding.id };
}

function resolveBindingTarget(
  bindings: PortBinding[],
  target: BindingTarget | null,
): PortBinding | null {
  if (!target) return null;
  const binding = bindings.find((candidate) => candidate.id === target.id);
  return binding && bindingFingerprint(binding) === target.fingerprint
    ? binding
    : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminationErrorMessage(error: unknown): string {
  const message = errorText(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("port binding changed")) {
    return "Binding changed before termination. No signal was sent; refresh and verify the new owner.";
  }
  if (normalized.includes("restricted") || normalized.includes("permission")) {
    return "Permission denied. This process is restricted; run with appropriate privileges and try again.";
  }
  if (normalized.includes("not found")) {
    return "Process not found. It may have already exited; refresh the binding list.";
  }
  return `Termination failed: ${message}`;
}

function App() {
  const [bindings, setBindings] = useState<PortBinding[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [query, setQuery] = useState("");
  const [protocolFilter, setProtocolFilter] =
    useState<ProtocolFilter>("all");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");
  const [bindingStateFilter, setBindingStateFilter] =
    useState<BindingStateFilter>("all");
  const [selectedTarget, setSelectedTarget] = useState<BindingTarget | null>(null);
  const [terminationTarget, setTerminationTarget] =
    useState<BindingTarget | null>(null);
  const [terminationError, setTerminationError] = useState<string | null>(null);
  const [isTerminating, setIsTerminating] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const hasBindingsRef = useRef(false);
  const isMountedRef = useRef(false);
  const refreshSequenceRef = useRef(0);
  const detailsTriggerRef = useRef<HTMLElement | null>(null);
  const terminationTriggerRef = useRef<HTMLElement | null>(null);
  const refreshButtonRef = useRef<HTMLButtonElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  const selectedBinding = useMemo(
    () => resolveBindingTarget(bindings, selectedTarget),
    [bindings, selectedTarget],
  );
  const terminationBinding = useMemo(
    () => resolveBindingTarget(bindings, terminationTarget),
    [bindings, terminationTarget],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const requestSequence = ++refreshSequenceRef.current;
    if (isMountedRef.current) {
      setIsRefreshing(true);
    }
    try {
      const nextBindings = await listPortBindings();
      if (
        !isMountedRef.current ||
        requestSequence !== refreshSequenceRef.current
      ) {
        return;
      }
      setBindings(nextBindings);
      hasBindingsRef.current = nextBindings.length > 0;
      setLoadState("ready");
      setLoadError(null);
      setIsStale(false);
      setLastRefreshed(new Date());
    } catch (error) {
      if (
        !isMountedRef.current ||
        requestSequence !== refreshSequenceRef.current
      ) {
        return;
      }
      setLoadError(errorText(error));
      if (hasBindingsRef.current) {
        setIsStale(true);
      } else {
        setLoadState("error");
      }
    } finally {
      if (
        isMountedRef.current &&
        requestSequence === refreshSequenceRef.current
      ) {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, refresh]);

  useEffect(() => {
    if (selectedTarget && !selectedBinding) {
      setSelectedTarget(null);
    }
  }, [selectedBinding, selectedTarget]);

  useEffect(() => {
    if (terminationTarget && !terminationBinding) {
      setTerminationTarget(null);
      setTerminationError(null);
    }
  }, [terminationBinding, terminationTarget]);

  const filteredBindings = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return bindings
      .filter((binding) => {
        if (protocolFilter !== "all" && binding.protocol !== protocolFilter) {
          return false;
        }
        if (accessFilter !== "all" && binding.access !== accessFilter) {
          return false;
        }
        if (
          bindingStateFilter !== "all" &&
          binding.state !== bindingStateFilter
        ) {
          return false;
        }
        if (!normalizedQuery) return true;

        return [
          binding.port,
          binding.pid,
          binding.processName,
          binding.localAddress,
          binding.userName,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(normalizedQuery),
        );
      })
      .sort(
        (left, right) =>
          left.port - right.port ||
          left.protocol.localeCompare(right.protocol) ||
          left.localAddress.localeCompare(right.localAddress),
      );
  }, [accessFilter, bindingStateFilter, bindings, deferredQuery, protocolFilter]);

  const handleTerminate = async () => {
    const bindingToTerminate = terminationBinding;
    if (!bindingToTerminate?.pid || bindingToTerminate.access === "restricted") {
      return;
    }

    const pid = bindingToTerminate.pid;
    setIsTerminating(true);
    setTerminationError(null);
    try {
      await terminateProcess({
        pid,
        protocol: bindingToTerminate.protocol,
        localAddress: bindingToTerminate.localAddress,
        port: bindingToTerminate.port,
      });
      if (!isMountedRef.current) return;
      const processLabel = bindingToTerminate.processName ?? "Process";
      const message = `${processLabel} PID ${pid} terminated gracefully.`;
      setSuccessMessage(message);
      setAnnouncement(message);
      await refresh();
      if (!isMountedRef.current) return;
      setTerminationTarget(null);
      setSelectedTarget(null);
    } catch (error) {
      if (isMountedRef.current) {
        setTerminationError(terminationErrorMessage(error));
      }
    } finally {
      if (isMountedRef.current) {
        setIsTerminating(false);
      }
    }
  };

  const openDetails = (binding: PortBinding, trigger: HTMLButtonElement) => {
    detailsTriggerRef.current = trigger;
    setSelectedTarget(createBindingTarget(binding));
  };

  const openTermination = (
    binding: PortBinding,
    trigger: HTMLButtonElement,
  ) => {
    terminationTriggerRef.current = trigger;
    setTerminationError(null);
    setTerminationTarget(createBindingTarget(binding));
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#binding-table">
        Skip to bindings
      </a>
      <ConsoleHeader
        autoRefresh={autoRefresh}
        isRefreshing={isRefreshing}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => void refresh()}
        refreshButtonRef={refreshButtonRef}
      />

      <main className="console-main">
        <div className="operation-status-stack">
          {isRefreshing && (
            <div className="operation-banner operation-banner--refresh" aria-live="polite">
              <span className="spinner spinner--compact" aria-hidden="true" />
              Refreshing bindings…
            </div>
          )}
          {successMessage && (
            <div className="operation-banner operation-banner--success" aria-label="Operation status" role="region">
              <span aria-hidden="true">✓</span>
              <strong>{successMessage}</strong>
              <button className="text-button" onClick={() => setSuccessMessage(null)} type="button">
                Dismiss
              </button>
            </div>
          )}
        </div>
        <section className="overview" aria-labelledby="overview-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Local socket inventory</p>
              <h2 id="overview-title">Active bindings</h2>
            </div>
            <p className="refresh-time">
              Last refreshed: {lastRefreshed ? lastRefreshed.toLocaleTimeString() : "Not yet"}
            </p>
          </div>
          <SummaryMetrics bindings={bindings} />
        </section>

        <section className="binding-console" aria-labelledby="bindings-title">
          <div className="section-heading console-heading">
            <div>
              <p className="eyebrow">Inspection surface</p>
              <h2 id="bindings-title">Network bindings</h2>
            </div>
            <span className="result-count" aria-live="polite">
              {filteredBindings.length} shown / {bindings.length} total
            </span>
          </div>

          <FilterBar
            accessFilter={accessFilter}
            bindingStateFilter={bindingStateFilter}
            onAccessFilterChange={setAccessFilter}
            onBindingStateFilterChange={setBindingStateFilter}
            onProtocolFilterChange={setProtocolFilter}
            onQueryChange={setQuery}
            protocolFilter={protocolFilter}
            query={query}
          />

          {isStale && (
            <div className="state-banner state-banner--warning" role="alert">
              <span aria-hidden="true">▲</span>
              <div>
                <strong>Showing stale data.</strong> The latest scan failed: {loadError}
              </div>
              <button className="text-button" onClick={() => void refresh()}>
                Retry scan
              </button>
            </div>
          )}

          {loadState === "loading" && bindings.length === 0 ? (
            <div className="loading-state" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <strong>Scanning local interfaces…</strong>
              <span>Resolving ports and process ownership.</span>
            </div>
          ) : loadState === "error" ? (
            <div className="error-state" role="alert">
              <span className="state-icon" aria-hidden="true">!</span>
              <div>
                <strong>Could not scan local ports.</strong>
                <p>{loadError}</p>
              </div>
              <button className="secondary-button" onClick={() => void refresh()}>
                Retry scan
              </button>
            </div>
          ) : (
            <BindingTable
              bindings={filteredBindings}
              hasFilters={
                query.length > 0 ||
                protocolFilter !== "all" ||
                accessFilter !== "all" ||
                bindingStateFilter !== "all"
              }
              onTerminate={openTermination}
              onViewDetails={openDetails}
              selectedId={selectedBinding?.id ?? null}
            />
          )}
        </section>
      </main>

      <ProcessDetailsPanel
        binding={selectedBinding}
        fallbackFocusRef={refreshButtonRef}
        onClose={() => setSelectedTarget(null)}
        onTerminate={openTermination}
        returnFocusRef={detailsTriggerRef}
      />
      <TerminateDialog
        binding={terminationBinding}
        error={terminationError}
        fallbackFocusRef={refreshButtonRef}
        isSubmitting={isTerminating}
        onCancel={() => {
          if (!isTerminating) {
            setTerminationTarget(null);
            setTerminationError(null);
          }
        }}
        onConfirm={() => void handleTerminate()}
        returnFocusRef={terminationTriggerRef}
        secondaryReturnFocusRef={detailsTriggerRef}
      />
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

export default App;
