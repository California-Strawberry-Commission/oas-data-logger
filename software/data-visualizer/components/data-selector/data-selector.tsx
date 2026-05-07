"use client";

import DayDataSelector from "@/components/data-selector/day/day-data-selector";
import RunDataSelector from "@/components/data-selector/run/run-data-selector";
import { Button } from "@/components/ui/button";
import { type Device, type Run } from "@/lib/api";
import posthog from "posthog-js";
import { useCallback, useState } from "react";

export type RunSelectionRow = {
  rowId: string;
  device: Device | null;
  run: Run | null;
};

export type DaySelectionRow = {
  rowId: string;
  device: Device | null;
  dayKey: string;
};

export type Selection =
  | { kind: "run"; rows: RunSelectionRow[] }
  | { kind: "day"; rows: DaySelectionRow[] };

export default function DataSelector({
  initialSelection,
  onSelectionChanged,
}: {
  initialSelection?: Selection;
  onSelectionChanged?: (next: Selection) => void;
}) {
  const [viewMode, setViewMode] = useState<"run" | "day">(
    initialSelection?.kind ?? "run",
  );

  const handleRunRowsChanged = useCallback(
    (rows: RunSelectionRow[]) => onSelectionChanged?.({ kind: "run", rows }),
    [onSelectionChanged],
  );

  const handleDayRowsChanged = useCallback(
    (rows: DaySelectionRow[]) => onSelectionChanged?.({ kind: "day", rows }),
    [onSelectionChanged],
  );

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex rounded-md border overflow-hidden">
        <Button
          variant={viewMode === "run" ? "default" : "ghost"}
          className="flex-1 rounded-none"
          onClick={() => {
            posthog.capture("selection:view_mode_changed", {
              view_mode: "run",
            });
            setViewMode("run");
          }}
        >
          Run
        </Button>
        <Button
          variant={viewMode === "day" ? "default" : "ghost"}
          className="flex-1 rounded-none"
          onClick={() => {
            posthog.capture("selection:view_mode_changed", {
              view_mode: "day",
            });
            setViewMode("day");
          }}
        >
          Day
        </Button>
      </div>

      {viewMode === "run" ? (
        <RunDataSelector
          initialRows={
            initialSelection?.kind === "run" ? initialSelection.rows : undefined
          }
          onRowsChanged={handleRunRowsChanged}
        />
      ) : (
        <DayDataSelector
          initialRows={
            initialSelection?.kind === "day" ? initialSelection.rows : undefined
          }
          onRowsChanged={handleDayRowsChanged}
        />
      )}
    </div>
  );
}
