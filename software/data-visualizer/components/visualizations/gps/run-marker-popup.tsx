"use client";

import { TRACK_LUCIDE_ICON } from "@/components/visualizations/gps/map-icons";
import { useUpdateRun } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Ban } from "lucide-react";
import posthog from "posthog-js";

export default function RunMarkerPopup({
  runUuid,
  timestampS,
  icon,
}: {
  runUuid: string;
  timestampS: number;
  icon?: string | null;
}) {
  const updateRun = useUpdateRun();

  const setIcon = (nextIcon: string | null) => {
    posthog.capture("run:icon_changed", { icon: nextIcon });
    updateRun.mutate({ uuid: runUuid, input: { icon: nextIcon } });
  };

  return (
    <div className="max-w-[220px] break-words text-sm">
      <div className="font-semibold">Run</div>
      <div>{runUuid}</div>
      <div className="mt-2 font-semibold">Time</div>
      <div>{`${new Date(timestampS * 1000).toLocaleString()}`}</div>
      <div className="mt-2 font-semibold">Icon</div>
      <div className="mt-1 flex gap-1.5">
        {Object.entries(TRACK_LUCIDE_ICON).map(([key, IconComponent]) => (
          <button
            key={key}
            type="button"
            onClick={() => setIcon(key)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
              icon === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <IconComponent className="h-3.5 w-3.5" />
          </button>
        ))}
        {/* Remove icon button */}
        <button
          type="button"
          onClick={() => setIcon(null)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
            !icon
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
