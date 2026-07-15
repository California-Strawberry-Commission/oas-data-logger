import {
  Check,
  MapPin,
  PersonStanding,
  Star,
  Tractor,
  TriangleAlert,
  X,
  type LucideProps,
} from "lucide-react";
import type React from "react";

export const TRACK_LUCIDE_ICON: Record<
  string,
  React.ComponentType<LucideProps>
> = {
  tractor: Tractor,
  person: PersonStanding,
};

export const POI_LUCIDE_ICON: Record<
  string,
  React.ComponentType<LucideProps>
> = {
  pin: MapPin,
  star: Star,
  alert: TriangleAlert,
  check: Check,
  x: X,
};
