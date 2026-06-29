import type { PoiIcon } from "@/lib/api";
import {
  Check,
  MapPin,
  Star,
  TriangleAlert,
  X,
  type LucideProps,
} from "lucide-react";
import type React from "react";

export const POI_LUCIDE_ICON: Record<
  PoiIcon,
  React.ComponentType<LucideProps>
> = {
  pin: MapPin,
  star: Star,
  alert: TriangleAlert,
  check: Check,
  x: X,
};
