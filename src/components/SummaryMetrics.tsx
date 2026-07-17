import type { PortBinding } from "../types/portCleaner";

interface SummaryMetricsProps {
  bindings: PortBinding[];
}

export function SummaryMetrics({ bindings }: SummaryMetricsProps) {
  const metrics = [
    { label: "监听端口", value: bindings.length, tone: "mint", symbol: "⌁" },
    { label: "TCP", value: bindings.filter((item) => item.protocol === "tcp").length, tone: "amber", symbol: "T" },
    { label: "UDP", value: bindings.filter((item) => item.protocol === "udp").length, tone: "blue", symbol: "U" },
    { label: "受限", value: bindings.filter((item) => item.access === "restricted").length, tone: "red", symbol: "!" },
  ];

  return (
    <div className="metrics-grid">
      {metrics.map((metric) => (
        <article className={`metric-card metric-card--${metric.tone}`} key={metric.label}>
          <span className="metric-symbol" aria-hidden="true">{metric.symbol}</span>
          <div>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
