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
