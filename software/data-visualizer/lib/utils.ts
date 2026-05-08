import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SELECTION_COLORS = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#7c3aed", // purple
  "#ea580c", // orange
  "#0891b2", // cyan
];

export function colorForSelectionIndex(i: number): string {
  return SELECTION_COLORS[i % SELECTION_COLORS.length];
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

/**
 * Formats an epoch time in seconds as a local time-of-day string, like "1:23 PM".
 *
 * @param epochTimeS - Epoch time in seconds.
 * @returns A local time-of-day string.
 */
export function formatTimeOfDay(epochTimeS: number): string {
  return new Date(epochTimeS * 1000).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Returns a `YYYY-MM-DD` string for the local calendar date of the given epoch time in seconds.
 *
 * @param epochTimeS - Epoch time in seconds.
 * @returns A string in `YYYY-MM-DD` format.
 */
export function getDayKey(epochTimeS: number): string {
  const date = new Date(epochTimeS * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}
