/**
 * Parses a duration string into milliseconds. Accepts "m:ss", "h:mm:ss",
 * plain second counts ("90"), or an already-numeric value. Returns 0 on
 * unparseable input.
 */
export function parseDuration(input: string | number): number {
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? input : 0;
  }

  const trimmed = input.trim();
  if (trimmed === "") return 0;

  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;

  let total = 0;
  for (const part of parts) {
    total = total * 60 + part;
  }
  return total * 1000;
}
