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
