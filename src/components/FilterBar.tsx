import type { Access, Protocol } from "../types/portCleaner";

export type AccessFilter = "all" | Access;
export type ProtocolFilter = "all" | Protocol;

interface FilterBarProps {
  accessFilter: AccessFilter;
  onAccessFilterChange: (value: AccessFilter) => void;
  onProtocolFilterChange: (value: ProtocolFilter) => void;
  onPortEndChange: (value: string) => void;
  onPortStartChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  protocolFilter: ProtocolFilter;
  portEnd: string;
  portStart: string;
  query: string;
}

export function FilterBar({
  accessFilter,
  onAccessFilterChange,
  onProtocolFilterChange,
  onPortEndChange,
  onPortStartChange,
  onQueryChange,
  protocolFilter,
  portEnd,
  portStart,
  query,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <label className="search-field">
        <span className="sr-only">搜索监听端口</span>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          aria-label="搜索监听端口"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索端口、进程、PID 或地址…"
          type="search"
          value={query}
        />
      </label>
      <label className="select-field">
        <span>协议</span>
        <select
          aria-label="协议"
          onChange={(event) =>
            onProtocolFilterChange(event.target.value as ProtocolFilter)
          }
          value={protocolFilter}
        >
          <option value="all">全部协议</option>
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
        </select>
      </label>
      <label className="select-field">
        <span>起始端口</span>
        <input
          aria-label="起始端口"
          inputMode="numeric"
          max="65535"
          min="1"
          onChange={(event) => onPortStartChange(event.target.value)}
          placeholder="例如 5000"
          type="number"
          value={portStart}
        />
      </label>
      <label className="select-field">
        <span>结束端口</span>
        <input
          aria-label="结束端口"
          inputMode="numeric"
          max="65535"
          min="1"
          onChange={(event) => onPortEndChange(event.target.value)}
          placeholder="例如 10000"
          type="number"
          value={portEnd}
        />
      </label>
      <label className="select-field">
        <span>权限</span>
        <select
          aria-label="权限"
          onChange={(event) =>
            onAccessFilterChange(event.target.value as AccessFilter)
          }
          value={accessFilter}
        >
          <option value="all">全部</option>
          <option value="allowed">可操作</option>
          <option value="restricted">受限</option>
        </select>
      </label>
    </div>
  );
}
