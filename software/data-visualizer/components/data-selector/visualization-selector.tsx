"use client";

import Combobox from "@/components/ui/combobox";
import {
  STREAM_ID_LATITUDE,
  STREAM_ID_LONGITUDE,
} from "@/components/visualizations/gps-visualization";
import type { RunMeta } from "@/lib/useRunMeta";
import useRunMeta from "@/lib/useRunMeta";
import { useEffect, useMemo } from "react";

export enum VisualizationType {
  NONE,
  GPS,
}

function hasGpsData(run: RunMeta): boolean {
  const streamIds = new Set(run.streams.map((s) => s.streamId));
  return (
    streamIds.has(STREAM_ID_LATITUDE) && streamIds.has(STREAM_ID_LONGITUDE)
  );
}

export default function VisualizationSelector({
  runUuid,
  value,
  onValueChange,
}: {
  runUuid: string;
  value: VisualizationType;
  onValueChange: (viz: VisualizationType) => void;
}) {
  const { run, error } = useRunMeta(runUuid);
  const isLoading = !!runUuid && !run && !error;

  const items = useMemo(() => {
    if (!runUuid) {
      return [{ value: "__no_run__", label: "Select a run first" }];
    }
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading visualizations..." }];
    }
    if (error) {
      return [{ value: "__error__", label: error }];
    }

    const out: { value: string; label: string }[] = [];
    if (run && hasGpsData(run)) {
      out.push({ value: String(VisualizationType.GPS), label: "GPS position" });
    }
    return out;
  }, [runUuid, isLoading, error, run]);

  const hasPlaceholder = items.length > 0 && items[0].value.startsWith("__");

  // Auto-select first available visualization
  useEffect(() => {
    if (items.length === 0 || hasPlaceholder) {
      return;
    }

    // If current selection is empty or no longer valid, pick the first option
    const isValid = items.some((i) => Number(i.value) === value);
    if (!isValid) {
      onValueChange(Number(items[0].value) as VisualizationType);
    }
  }, [hasPlaceholder, items, value, onValueChange]);

  return (
    <>
      <div className="flex items-center gap-2">
        <Combobox
          items={items}
          value={value === VisualizationType.NONE ? "" : String(value)}
          onValueChange={(next) => {
            // Ignore placeholder items
            if (next.startsWith("__")) {
              return;
            }

            if (!next) {
              onValueChange(VisualizationType.NONE);
              return;
            }
            onValueChange(Number(next) as VisualizationType);
          }}
          placeholder={
            isLoading ? "Loading visualizations..." : "Select visualization..."
          }
          searchPlaceholder={
            isLoading ? "Loading..." : "Search visualization..."
          }
          disabled={hasPlaceholder}
        />
        {run?.isActive && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            Live
          </span>
        )}
      </div>
    </>
  );
}
