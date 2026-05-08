"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import DayGpsVisualization, {
  type DayGroup,
} from "@/components/visualizations/gps/day-gps-visualization";
import RunGpsVisualization, {
  type RunWithColor,
} from "@/components/visualizations/gps/run-gps-visualization";
import { useMultipleDeviceRuns } from "@/lib/api";
import { colorForSelectionIndex, getDayKey } from "@/lib/utils";
import { useMemo } from "react";

export default function VisualizationArea({
  selection,
}: {
  selection: Selection;
}) {
  // For run selection mode, create RunWithColor[] from selection
  const runsWithColor: RunWithColor[] = useMemo(() => {
    if (selection.kind !== "run") {
      return [];
    }
    return selection.rows.flatMap((r, idx) =>
      r.run
        ? [
            {
              run: r.run,
              color: colorForSelectionIndex(idx),
              device: r.device ?? undefined,
            },
          ]
        : [],
    );
  }, [selection]);

  // For day selection mode, create DayGroup[] from selection
  const deviceIds = useMemo(
    () =>
      selection.kind === "day"
        ? selection.rows.map((r) => r.device?.id ?? "")
        : [],
    [selection],
  );
  const { runsByDeviceId, anyLoading } = useMultipleDeviceRuns(deviceIds);
  const dayGroups: DayGroup[] = useMemo(() => {
    if (selection.kind !== "day") {
      return [];
    }
    return selection.rows
      .map((row, idx) => {
        const deviceId = row.device?.id ?? "";
        const { dayKey } = row;
        if (!deviceId || !dayKey) {
          return null;
        }

        const allRuns = runsByDeviceId[deviceId] ?? [];
        const runs = allRuns
          .filter((r) => getDayKey(r.epochTimeS) === dayKey)
          .sort((a, b) => a.epochTimeS - b.epochTimeS);
        return {
          dayKey,
          color: colorForSelectionIndex(idx),
          runs,
          device: row.device ?? undefined,
        };
      })
      .filter((g) => g !== null);
  }, [selection, runsByDeviceId]);

  if (selection.kind === "run") {
    if (runsWithColor.length === 0) {
      return (
        <div className="h-full w-full flex items-center justify-center text-muted-foreground p-4 text-center">
          Select a run.
        </div>
      );
    }

    return (
      <div className="flex flex-col w-full items-center p-4 gap-4 md:overflow-y-auto">
        <RunGpsVisualization runs={runsWithColor} />
      </div>
    );
  } else {
    const hasAnyValidRow = selection.rows.some((r) => r.device && r.dayKey);
    if (!hasAnyValidRow) {
      return (
        <div className="h-full w-full flex items-center justify-center text-muted-foreground p-4 text-center">
          Select a device and day.
        </div>
      );
    }

    if (anyLoading) {
      return (
        <div className="h-full w-full flex items-center justify-center text-muted-foreground p-4 text-center">
          Loading...
        </div>
      );
    }

    return (
      <div className="flex flex-col w-full items-center p-4 gap-4 md:overflow-y-auto">
        <DayGpsVisualization dayGroups={dayGroups} />
      </div>
    );
  }
}
