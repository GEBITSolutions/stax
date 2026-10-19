/** Narrows parsed YAML/JSON to a mapping; values stay unknown. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
