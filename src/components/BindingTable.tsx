import type { PortBinding } from "../types/portCleaner";

interface BindingTableProps {
  bindings: PortBinding[];
  hasFilters: boolean;
  onTerminate: (binding: PortBinding, trigger: HTMLButtonElement) => void;
  onViewDetails: (binding: PortBinding, trigger: HTMLButtonElement) => void;
  selectedId: string | null;
}

function canTerminate(binding: PortBinding): boolean {
  return Number.isInteger(binding.pid) && Boolean(binding.pid && binding.pid > 0) && binding.access === "allowed";
}

export function BindingTable({
  bindings,
  hasFilters,
  onTerminate,
  onViewDetails,
  selectedId,
}: BindingTableProps) {
  if (bindings.length === 0) {
    return (
      <div className="empty-state">
        <span aria-hidden="true">◇</span>
        <strong>{hasFilters ? "No bindings match these filters." : "No visible bindings found."}</strong>
        <p>{hasFilters ? "Clear or broaden the current search criteria." : "The next automatic scan will check again."}</p>
      </div>
    );
  }

  return (
    <div className="table-frame" id="binding-table">
      <table>
        <caption className="sr-only">Visible local network bindings and process ownership</caption>
        <thead>
          <tr>
            <th scope="col">Protocol</th>
            <th scope="col">Address</th>
            <th scope="col">Port</th>
            <th scope="col">State</th>
            <th scope="col">Process</th>
            <th scope="col">PID</th>
            <th scope="col">User</th>
            <th scope="col">Access</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {bindings.map((binding) => {
            const terminable = canTerminate(binding);
            return (
              <tr
                className={selectedId === binding.id ? "is-selected" : undefined}
                data-selected={selectedId === binding.id ? "true" : undefined}
                key={binding.id}
              >
                <td data-label="Protocol"><span className={`protocol-badge protocol-badge--${binding.protocol}`}>{binding.protocol.toUpperCase()}</span></td>
                <td data-label="Address"><code>{binding.localAddress}</code></td>
                <td data-label="Port"><strong className="port-number">{binding.port}</strong></td>
                <td data-label="State"><span className={`state-badge state-badge--${binding.state}`}><span aria-hidden="true" />{binding.state}</span></td>
                <td data-label="Process"><strong>{binding.processName ?? "Unknown process"}</strong></td>
                <td data-label="PID"><code>{binding.pid ?? "—"}</code></td>
                <td data-label="User">{binding.userName ?? "—"}</td>
                <td data-label="Access"><span className={`access-badge access-badge--${binding.access}`}>{binding.access === "allowed" ? "✓ Allowed" : "⚿ Restricted"}</span></td>
                <td className="actions-cell" data-label="Actions">
                  <div className="row-actions">
                    <button
                      aria-label={`View process details for ${binding.processName ?? "Unknown process"} on port ${binding.port}`}
                      className="details-button"
                      onClick={(event) => onViewDetails(binding, event.currentTarget)}
                      type="button"
                    >
                      Details
                    </button>
                    <button
                      aria-label={terminable ? `Terminate ${binding.processName ?? "process"} PID ${binding.pid}` : "Terminate unavailable"}
                      className="terminate-button"
                      disabled={!terminable}
                      onClick={(event) => onTerminate(binding, event.currentTarget)}
                      title={terminable ? "Gracefully terminate process" : "PID unavailable or access restricted"}
                      type="button"
                    >
                      Terminate
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
