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
  "#e11d48", // rose
  "#4b5563", // gray
];

export function fnv1a32(str: string): number {
  let h = 0x811c9dc5; // 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // 16777619
  }
  return h >>> 0;
}

export function colorForRun(uuid: string): string {
  // Use deterministic hash (in this case the FNV hash function) for
  // stable color per run
  let h = 2166136261;
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return RUN_COLORS[Math.abs(h) % RUN_COLORS.length];
}

export function colorForRunV2(runUuid: string): string {
  const h = fnv1a32(runUuid);

  // Hue in [0, 360). Using full range avoids 1/N bucket collisions.
  const hue = h % 360;

  // Keep S/L in a nice UI-friendly range.
  const sat = 70; // 0–100
  const light = 45; // 0–100

  return `hsl(${hue} ${sat}% ${light}%)`;
}
