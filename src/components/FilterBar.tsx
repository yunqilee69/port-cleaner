import type { Access, BindingState, Protocol } from "../types/portCleaner";

export type AccessFilter = "all" | Access;
export type BindingStateFilter = "all" | BindingState;
export type ProtocolFilter = "all" | Protocol;

interface FilterBarProps {
  accessFilter: AccessFilter;
  bindingStateFilter: BindingStateFilter;
  onAccessFilterChange: (value: AccessFilter) => void;
  onBindingStateFilterChange: (value: BindingStateFilter) => void;
  onProtocolFilterChange: (value: ProtocolFilter) => void;
  onQueryChange: (value: string) => void;
  protocolFilter: ProtocolFilter;
  query: string;
}

export function FilterBar({
  accessFilter,
  bindingStateFilter,
  onAccessFilterChange,
  onBindingStateFilterChange,
  onProtocolFilterChange,
  onQueryChange,
  protocolFilter,
  query,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <label className="search-field">
        <span className="sr-only">Search bindings</span>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          aria-label="Search bindings"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search port, process, PID, or address…"
          type="search"
          value={query}
        />
        <kbd>⌘ K</kbd>
      </label>
      <label className="select-field">
        <span>Protocol</span>
        <select
          aria-label="Protocol"
          onChange={(event) =>
            onProtocolFilterChange(event.target.value as ProtocolFilter)
          }
          value={protocolFilter}
        >
          <option value="all">All protocols</option>
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
        </select>
      </label>
      <label className="select-field">
        <span>Access</span>
        <select
          aria-label="Access"
          onChange={(event) =>
            onAccessFilterChange(event.target.value as AccessFilter)
          }
          value={accessFilter}
        >
          <option value="all">All access</option>
          <option value="allowed">Allowed</option>
          <option value="restricted">Restricted</option>
        </select>
      </label>
      <label className="select-field">
        <span>Binding state</span>
        <select
          aria-label="Binding state"
          onChange={(event) =>
            onBindingStateFilterChange(event.target.value as BindingStateFilter)
          }
          value={bindingStateFilter}
        >
          <option value="all">All states</option>
          <option value="listening">Listening</option>
          <option value="connected">Connected</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
    </div>
  );
}
