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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}
