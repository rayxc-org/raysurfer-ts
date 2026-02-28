/**
 * Per-function telemetry via raysurferLogging() — agents call this
 * inside cached functions.
 */

interface FunctionTelemetry {
  callCount: number;
  totalValueSize: number;
  emptyCount: number;
  valueTypes: Record<string, number>;
}

const CAP = 1000;
const telemetry = new Map<string, FunctionTelemetry>();

/**
 * Log a value from inside a cached function for per-function
 * telemetry.
 *
 * Uses Error().stack to identify the caller — no decorator needed.
 * Accumulates metrics (type, size, emptiness) per function in
 * memory, flushed automatically on process exit.
 */
export function raysurferLogging(value: unknown): void {
  const funcName = _getCallerName();

  const valueType = _getTypeName(value);
  const valueSize = _getSize(value);
  const isEmpty = _isEmpty(value);

  let entry = telemetry.get(funcName);
  if (!entry) {
    entry = {
      callCount: 0,
      totalValueSize: 0,
      emptyCount: 0,
      valueTypes: {},
    };
    telemetry.set(funcName, entry);
  }

  entry.callCount += 1;
  if (entry.callCount <= CAP) {
    entry.totalValueSize += valueSize;
    if (isEmpty) {
      entry.emptyCount += 1;
    }
    entry.valueTypes[valueType] = (entry.valueTypes[valueType] ?? 0) + 1;
  }
}

/** Drop-in alias for raysurferLogging(). */
export function log(value: unknown): void {
  raysurferLogging(value);
}

/** Return accumulated telemetry as a JSON string. */
export function getTelemetryJson(): string {
  return JSON.stringify(_buildPayload());
}

/** Clear all accumulated telemetry (for testing). */
export function resetTelemetry(): void {
  telemetry.clear();
}

function _getCallerName(): string {
  const err = new Error();
  const stack = err.stack ?? "";
  // Stack format: "Error\n    at raysurferLogging (...)\n    at callerName (...)\n..."
  const lines = stack.split("\n");
  // lines[0] = "Error", lines[1] = raysurferLogging, lines[2] = actual caller
  const callerLine = lines[2];
  if (callerLine) {
    const trimmed = callerLine.trim();
    // "at functionName (file:line:col)" or "at file:line:col"
    const match = trimmed.match(/^at\s+([^\s(]+)/);
    if (match?.[1] && match[1] !== "Object.<anonymous>") {
      return match[1];
    }
  }
  return "__module__";
}

function _getTypeName(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function _getSize(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).length;
  }
  return String(value).length;
}

function _isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).length === 0;
  }
  return false;
}

interface TelemetryPayload {
  raysurfer_telemetry: {
    version: number;
    functions: Record<
      string,
      {
        call_count: number;
        avg_value_size: number;
        empty_rate: number;
        value_types: Record<string, number>;
      }
    >;
  };
}

function _buildPayload(): TelemetryPayload {
  const functions: TelemetryPayload["raysurfer_telemetry"]["functions"] = {};
  for (const [funcName, entry] of telemetry) {
    const effectiveCount = Math.min(entry.callCount, CAP);
    const avgSize =
      effectiveCount > 0 ? entry.totalValueSize / effectiveCount : 0;
    const emptyRate =
      effectiveCount > 0 ? entry.emptyCount / effectiveCount : 0;
    functions[funcName] = {
      call_count: entry.callCount,
      avg_value_size: Math.round(avgSize * 100) / 100,
      empty_rate: Math.round(emptyRate * 10000) / 10000,
      value_types: entry.valueTypes,
    };
  }
  return {
    raysurfer_telemetry: {
      version: 1,
      functions,
    },
  };
}

function _flushTelemetry(): void {
  if (telemetry.size === 0) return;
  try {
    const payload = _buildPayload();
    process.stdout.write("\n--- RAYSURFER_TELEMETRY_START ---\n");
    process.stdout.write(JSON.stringify(payload));
    process.stdout.write("\n--- RAYSURFER_TELEMETRY_END ---\n");
  } catch {
    // stdout may be closed at exit
  }
}

process.on("exit", _flushTelemetry);
