/**
 * Zero-dependency in-process metrics registry (Prometheus text exposition).
 * Backs the shipped Grafana dashboards/alerts without prom-client:
 *  - http_request_duration_seconds_bucket (per route)
 *  - jobs_total / jobs_failed_total
 *  - simulation_runs_total
 *  - llm_routing_decisions_total{tier}
 *  - ingestion_records_total
 */

type Labels = Record<string, string>;

function labelKey(labels?: Labels): string {
  if (!labels) return "";
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`)
    .join(",");
}

class Counter {
  public name: string;
  public help: string;
  private values = new Map<string, number>();
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  inc(labels?: Labels, n = 1) {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + n);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const [key, v] of this.values) {
      lines.push(key ? `${this.name}{${key}} ${v}` : `${this.name} ${v}`);
    }
    return lines.join("\n");
  }
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Histogram {
  public name: string;
  public help: string;
  public bounds: number[];
  private buckets = new Map<string, number[]>(); // labelKey -> counts per bucket bound
  private sums = new Map<string, number>();
  private counts = new Map<string, number>();
  constructor(name: string, help: string, bounds: number[] = DEFAULT_BUCKETS) {
    this.name = name;
    this.help = help;
    this.bounds = bounds;
  }
  observe(value: number, labels?: Labels) {
    const key = labelKey(labels);
    const arr = this.buckets.get(key) ?? new Array(this.bounds.length).fill(0);
    for (let i = 0; i < this.bounds.length; i++) {
      if (value <= this.bounds[i]) arr[i] += 1;
    }
    this.buckets.set(key, arr);
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, arr] of this.buckets) {
      const prefix = key ? `{${key},` : "{";
      for (let i = 0; i < this.bounds.length; i++) {
        lines.push(`${this.name}_bucket${prefix}le="${this.bounds[i]}"} ${arr[i]}`);
      }
      lines.push(`${this.name}_bucket${prefix}le="+Inf"} ${this.counts.get(key) ?? 0}`);
      lines.push(`${this.name}_sum${key ? `{${key}}` : ""} ${this.sums.get(key) ?? 0}`);
      lines.push(`${this.name}_count${key ? `{${key}}` : ""} ${this.counts.get(key) ?? 0}`);
    }
    return lines.join("\n");
  }
}

export const httpRequestDuration = new Histogram(
  "http_request_duration_seconds",
  "HTTP request latency by route",
);
export const jobsTotal = new Counter("jobs_total", "Jobs enqueued by type");
export const jobsFailedTotal = new Counter("jobs_failed_total", "Jobs failed by type");
export const simulationRunsTotal = new Counter(
  "simulation_runs_total",
  "Simulation runs by engine and bridge",
);
export const llmRoutingDecisions = new Counter(
  "llm_routing_decisions_total",
  "LLM routing decisions by tier",
);
export const ingestionRecordsTotal = new Counter(
  "ingestion_records_total",
  "Records ingested by source",
);
export const eventsEmittedTotal = new Counter(
  "events_emitted_total",
  "Domain events emitted by topic",
);

const ALL = [
  httpRequestDuration,
  jobsTotal,
  jobsFailedTotal,
  simulationRunsTotal,
  llmRoutingDecisions,
  ingestionRecordsTotal,
  eventsEmittedTotal,
];

/** Prometheus text exposition format. */
export function renderMetrics(): string {
  return ALL.map((m) => m.render()).join("\n") + "\n";
}

/** Observe an HTTP request (called from the Hono middleware in boot.ts). */
export function observeHttp(route: string, method: string, status: number, seconds: number) {
  httpRequestDuration.observe(seconds, {
    route,
    method: method.toUpperCase(),
    status: String(status),
  });
}
