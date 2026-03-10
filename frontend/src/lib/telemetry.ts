/**
 * Lightweight analytics / telemetry helper.
 *
 * Batches events in memory and flushes to the backend metrics endpoint
 * every 2 seconds.  Fire-and-forget — failures are silently swallowed.
 */

const FLUSH_INTERVAL_MS = 2_000;
const ENDPOINT = "/api/v1/zkdefi/metrics/event";

interface TelemetryEvent {
  event: string;
  properties?: Record<string, unknown>;
  ts: number;
}

let _buffer: TelemetryEvent[] = [];
let _timer: ReturnType<typeof setTimeout> | null = null;

function _flush(): void {
  if (_buffer.length === 0) return;
  const events = _buffer.splice(0);
  _timer = null;
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    }).catch(() => {});
  } catch {
    /* swallow */
  }
}

/**
 * Fire-and-forget analytics event.
 * Events are batched and flushed every ~2 s.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, unknown>,
): void {
  _buffer.push({ event: name, properties, ts: Date.now() });
  if (!_timer) {
    _timer = setTimeout(_flush, FLUSH_INTERVAL_MS);
  }
}
