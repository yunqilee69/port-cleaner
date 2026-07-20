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
  type ProtocolFilter,
} from "./components/FilterBar";
import { ProcessDetailsPanel } from "./components/ProcessDetailsPanel";
import { TerminateDialog } from "./components/TerminateDialog";
import type { PortBinding } from "./types/portCleaner";

const REFRESH_INTERVAL_MS = 5_000;

type LoadState = "loading" | "ready" | "error";
type RefreshMode = "join-active" | "after-active";

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
    return "结束前端口占用已变化，未发送结束信号；请刷新后确认新的占用进程。";
  }
  if (normalized.includes("restricted") || normalized.includes("permission")) {
    return "权限不足。该进程受限，请使用适当权限重新运行后再试。";
  }
  if (normalized.includes("not found")) {
    return "未找到进程。它可能已退出，请刷新监听端口列表。";
  }
  return `结束进程失败：${message}`;
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
  const [portStart, setPortStart] = useState("");
  const [portEnd, setPortEnd] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<BindingTarget | null>(null);
  const [terminationTarget, setTerminationTarget] =
    useState<BindingTarget | null>(null);
  const [terminationError, setTerminationError] = useState<string | null>(null);
  const [isTerminating, setIsTerminating] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const hasBindingsRef = useRef(false);
  const activeRefreshRef = useRef<Promise<void> | null>(null);
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
  const bindingStatistics = useMemo(() => ({
    restricted: bindings.filter((binding) => binding.access === "restricted").length,
    tcp: bindings.filter((binding) => binding.protocol === "tcp").length,
    udp: bindings.filter((binding) => binding.protocol === "udp").length,
  }), [bindings]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (
    mode: RefreshMode = "join-active",
  ): Promise<void> => {
    const activeRefresh = activeRefreshRef.current;
    if (activeRefresh) {
      if (mode === "join-active") {
        return activeRefresh;
      }
      await activeRefresh;
      if (!isMountedRef.current) {
        return;
      }
      if (activeRefreshRef.current) {
        return activeRefreshRef.current;
      }
    }

    const requestSequence = ++refreshSequenceRef.current;
    if (isMountedRef.current) {
      setIsRefreshing(true);
    }
    const request = (async () => {
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
        activeRefreshRef.current = null;
      }
    })();
    activeRefreshRef.current = request;
    return request;
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
    const start = portStart === "" ? null : Number(portStart);
    const end = portEnd === "" ? null : Number(portEnd);
    const hasInvalidRange =
      (start !== null && (!Number.isInteger(start) || start < 1 || start > 65535)) ||
      (end !== null && (!Number.isInteger(end) || end < 1 || end > 65535)) ||
      (start !== null && end !== null && start > end);

    return bindings
      .filter((binding) => {
        if (hasInvalidRange) {
          return false;
        }
        if (binding.state !== "listening") {
          return false;
        }
        if (start !== null && binding.port < start) {
          return false;
        }
        if (end !== null && binding.port > end) {
          return false;
        }
        if (protocolFilter !== "all" && binding.protocol !== protocolFilter) {
          return false;
        }
        if (accessFilter !== "all" && binding.access !== accessFilter) {
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
  }, [accessFilter, bindings, deferredQuery, portEnd, portStart, protocolFilter]);

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
      const processLabel = bindingToTerminate.processName ?? "该进程";
      const message = `已向 ${processLabel}（PID ${pid}）发送正常结束信号。`;
      setSuccessMessage(message);
      setAnnouncement(message);
      await refresh("after-active");
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
        跳到监听端口列表
      </a>
      <ConsoleHeader
        autoRefresh={autoRefresh}
        isRefreshing={isRefreshing}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => void refresh()}
        refreshButtonRef={refreshButtonRef}
      />

      <main className="console-main">
        {successMessage && (
          <div className="operation-status-stack">
            <div className="operation-banner operation-banner--success" aria-label="操作状态" role="region">
              <span aria-hidden="true">✓</span>
              <strong>{successMessage}</strong>
              <button className="text-button" onClick={() => setSuccessMessage(null)} type="button">
                关闭
              </button>
            </div>
          </div>
        )}
        <section className="binding-console" aria-labelledby="bindings-title">
          <div className="section-heading console-heading">
            <div>
              <p className="eyebrow">端口检查</p>
              <h2 id="bindings-title">监听端口</h2>
            </div>
            <div aria-label="端口统计" className="binding-statistics" role="region">
              <span className="result-count" aria-live="polite">
                显示 {filteredBindings.length} / 共 {bindings.length} 个
              </span>
              <span className="binding-stat"><strong>TCP</strong> {bindingStatistics.tcp}</span>
              <span className="binding-stat"><strong>UDP</strong> {bindingStatistics.udp}</span>
              <span className="binding-stat binding-stat--restricted"><strong>受限</strong> {bindingStatistics.restricted}</span>
              <span className="refresh-time">
                最近刷新：{lastRefreshed ? lastRefreshed.toLocaleTimeString() : "尚未刷新"}
              </span>
            </div>
          </div>

          <FilterBar
            accessFilter={accessFilter}
            onAccessFilterChange={setAccessFilter}
            onPortEndChange={setPortEnd}
            onPortStartChange={setPortStart}
            onProtocolFilterChange={setProtocolFilter}
            onQueryChange={setQuery}
            protocolFilter={protocolFilter}
            portEnd={portEnd}
            portStart={portStart}
            query={query}
          />

          {isStale && (
            <div className="state-banner state-banner--warning" role="alert">
              <span aria-hidden="true">▲</span>
              <div>
                <strong>正在显示上一次结果。</strong>最新扫描失败：{loadError}
              </div>
              <button className="text-button" onClick={() => void refresh()}>
                重试扫描
              </button>
            </div>
          )}

          {loadState === "loading" && bindings.length === 0 ? (
            <div className="loading-state" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <strong>正在扫描本机监听端口…</strong>
              <span>正在关联端口与占用进程。</span>
            </div>
          ) : loadState === "error" ? (
            <div className="error-state" role="alert">
              <span className="state-icon" aria-hidden="true">!</span>
              <div>
                <strong>无法扫描本机监听端口。</strong>
                <p>{loadError}</p>
              </div>
              <button className="secondary-button" onClick={() => void refresh()}>
                重试扫描
              </button>
            </div>
          ) : (
            <BindingTable
              bindings={filteredBindings}
              hasFilters={
                query.length > 0 ||
                protocolFilter !== "all" ||
                accessFilter !== "all"
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
