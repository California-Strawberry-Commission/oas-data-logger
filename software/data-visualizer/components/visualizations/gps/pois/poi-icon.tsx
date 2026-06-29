import type { PoiIcon } from "@/lib/api";
import {
  Flag,
  FlagTriangleRight,
  MapPin,
  Star,
  TriangleAlert,
  type LucideProps,
} from "lucide-react";
import type React from "react";

export const POI_LUCIDE_ICON: Record<
  PoiIcon,
  React.ComponentType<LucideProps>
> = {
  pin: MapPin,
  flag: Flag,
  star: Star,
  warning: TriangleAlert,
  checkpoint: FlagTriangleRight,
};

export const POI_COLOR_PRESETS = [
  "#6366f1", // indigo (default)
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#1e293b", // slate
];
