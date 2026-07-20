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
        <strong>{hasFilters ? "没有符合筛选条件的监听端口。" : "暂未发现监听端口。"}</strong>
        <p>{hasFilters ? "请清空或放宽当前筛选条件。" : "下次自动刷新时会再次检查。"}</p>
      </div>
    );
  }

  return (
    <div className="table-frame" id="binding-table">
      <table>
        <caption className="sr-only">本机监听端口及其占用进程</caption>
        <thead>
          <tr>
            <th scope="col">协议</th>
            <th scope="col">地址</th>
            <th scope="col">端口</th>
            <th scope="col">状态</th>
            <th scope="col">进程</th>
            <th scope="col">PID</th>
            <th scope="col">用户</th>
            <th scope="col">权限</th>
            <th scope="col"><span className="sr-only">操作</span></th>
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
                <td data-label="协议"><span className={`protocol-badge protocol-badge--${binding.protocol}`}>{binding.protocol.toUpperCase()}</span></td>
                <td data-label="地址"><code className="cell-text cell-text--address" title={binding.localAddress}>{binding.localAddress}</code></td>
                <td data-label="端口"><strong className="port-number">{binding.port}</strong></td>
                <td data-label="状态"><span className={`state-badge state-badge--${binding.state}`}><span aria-hidden="true" />监听中</span></td>
                <td data-label="进程"><strong className="cell-text cell-text--process" title={binding.processName ?? "未知进程"}>{binding.processName ?? "未知进程"}</strong></td>
                <td data-label="PID"><code>{binding.pid ?? "—"}</code></td>
                <td data-label="用户"><span className="cell-text cell-text--user" title={binding.userName ?? "不可用"}>{binding.userName ?? "—"}</span></td>
                <td data-label="权限"><span className={`access-badge access-badge--${binding.access}`}>{binding.access === "allowed" ? "✓ 可操作" : "⚿ 受限"}</span></td>
                <td className="actions-cell" data-label="操作">
                  <div className="row-actions">
                    <button
                      aria-label={`查看 ${binding.processName ?? "未知进程"} 的进程详情，端口 ${binding.port}`}
                      className="details-button"
                      onClick={(event) => onViewDetails(binding, event.currentTarget)}
                      type="button"
                    >
                      详情
                    </button>
                    <button
                      aria-label={terminable ? `结束 ${binding.processName ?? "进程"}，PID ${binding.pid}` : "无法结束进程"}
                      className="terminate-button"
                      disabled={!terminable}
                      onClick={(event) => onTerminate(binding, event.currentTarget)}
                      title={terminable ? "结束进程" : "PID 不可用或权限受限"}
                      type="button"
                    >
                      结束
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
