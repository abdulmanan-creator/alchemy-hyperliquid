/**
 * In-process metrics, exposed as Prometheus text at GET /metrics.
 *
 * Hand-rolled counters instead of prom-client: we need four counters and a
 * gauge, not a dependency. Values reset on process restart (standard for
 * Prometheus counters — rate() handles it).
 *
 * The business metric that matters: alchemy_builder_fee_usd_total — the
 * estimated builder fee earned, computed from HL fill responses (filled
 * notional × wire fee). "Estimated" because HL is the source of truth for
 * actual accrual; this tracks what we routed.
 */

type Labels = Record<string, string | number>;

class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = serializeLabels(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  expose(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    for (const [labelStr, v] of this.values) {
      lines.push(`${this.name}${labelStr} ${v}`);
    }
    return lines.join("\n");
  }
}

function serializeLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const inner = keys
    .map((k) => `${k}="${String(labels[k]).replace(/(["\\])/g, "\\$1")}"`)
    .join(",");
  return `{${inner}}`;
}

export const metrics = {
  httpRequests: new Counter(
    "alchemy_http_requests_total",
    "HTTP requests served, by route/method/status.",
  ),
  hlForwards: new Counter(
    "alchemy_hl_forwards_total",
    "Signed actions forwarded to Hyperliquid, by action type and outcome.",
  ),
  ordersFilled: new Counter(
    "alchemy_orders_filled_total",
    "Order fills (full or partial) observed in HL responses, by signing path.",
  ),
  filledNotionalUsd: new Counter(
    "alchemy_filled_notional_usd_total",
    "USD notional filled through us, by signing path.",
  ),
  builderFeeUsd: new Counter(
    "alchemy_builder_fee_usd_total",
    "Estimated builder fee earned in USD (filled notional x configured fee).",
  ),
  duplicatesRejected: new Counter(
    "alchemy_duplicate_requests_total",
    "Requests rejected by replay/idempotency guards, by route.",
  ),
  geoBlocked: new Counter(
    "alchemy_geo_blocked_total",
    "Requests rejected by jurisdiction gating, by country and reason.",
  ),

  expose(): string {
    return (
      [
        this.httpRequests,
        this.hlForwards,
        this.ordersFilled,
        this.filledNotionalUsd,
        this.builderFeeUsd,
        this.duplicatesRejected,
        this.geoBlocked,
      ]
        .map((c) => c.expose())
        .join("\n\n") + "\n"
    );
  },
};

/**
 * Record fill + fee metrics from an HL /exchange response to an order action.
 *
 * Response shape (status "ok"):
 *   { status: "ok", response: { type: "order", data: { statuses: [
 *       { filled: { totalSz: "0.001", avgPx: "97123.0" } } | { resting: ... } | { error: ... }
 *   ] } } }
 *
 * `builderFeeWire` is the wire-format fee (tenths of a basis point — f=40
 * means 4 bps), so feeUsd = notional * f / 1e5.
 */
export function recordOrderOutcome(
  exchangeResponse: unknown,
  builderFeeWire: number | undefined,
  path: "user" | "agent",
): void {
  const statuses = extractStatuses(exchangeResponse);
  if (!statuses) return;
  for (const s of statuses) {
    const filled = (s as { filled?: { totalSz?: string; avgPx?: string } }).filled;
    if (!filled?.totalSz || !filled.avgPx) continue;
    const notional = Number(filled.totalSz) * Number(filled.avgPx);
    if (!Number.isFinite(notional) || notional <= 0) continue;
    metrics.ordersFilled.inc({ path });
    metrics.filledNotionalUsd.inc({ path }, notional);
    if (builderFeeWire && builderFeeWire > 0) {
      metrics.builderFeeUsd.inc({ path }, (notional * builderFeeWire) / 1e5);
    }
  }
}

function extractStatuses(res: unknown): unknown[] | undefined {
  if (typeof res !== "object" || res === null) return undefined;
  const r = res as { status?: unknown; response?: { data?: { statuses?: unknown[] } } };
  if (r.status !== "ok") return undefined;
  const statuses = r.response?.data?.statuses;
  return Array.isArray(statuses) ? statuses : undefined;
}
