import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const RUN_COLORS = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#7c3aed", // purple
  "#ea580c", // orange
  "#0891b2", // cyan
];

export function colorForRunIndex(i: number): string {
  return RUN_COLORS[i % RUN_COLORS.length];
}

export function colorForRssi(rssiDbm: number): string {
  const t = Math.max(0, Math.min(1, (rssiDbm - -100) / (-30 - -100)));
  const hue = Math.round(t * 120);
  return `hsl(${hue}, 100%, 45%)`;
}

/**
 * Formats an elapsed time in seconds as a human-readable string.
 *
 * @param seconds - Elapsed time in seconds.
 * @returns A string in `Xh Ym Zs`, `Ym Zs`, or `Zs` form.
 */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}
