"use client";

import SessionDataSelector from "@/components/data-selector/session/session-data-selector";
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

export type SessionSelectionRow = {
  rowId: string;
  device: Device | null;
  sessionKey: string;
};

export type Selection =
  | { kind: "run"; rows: RunSelectionRow[] }
  | { kind: "session"; rows: SessionSelectionRow[] };

export default function DataSelector({
  initialSelection,
  onSelectionChanged,
}: {
  initialSelection?: Selection;
  onSelectionChanged?: (next: Selection) => void;
}) {
  const [viewMode, setViewMode] = useState<"run" | "session">(
    initialSelection?.kind ?? "session",
  );

  const handleRunRowsChanged = useCallback(
    (rows: RunSelectionRow[]) => onSelectionChanged?.({ kind: "run", rows }),
    [onSelectionChanged],
  );

  const handleSessionRowsChanged = useCallback(
    (rows: SessionSelectionRow[]) =>
      onSelectionChanged?.({ kind: "session", rows }),
    [onSelectionChanged],
  );

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex rounded-md border overflow-hidden">
        <Button
          variant={viewMode === "session" ? "default" : "ghost"}
          className="flex-1 rounded-none"
          onClick={() => {
            posthog.capture("selection:view_mode_changed", {
              view_mode: "session",
            });
            setViewMode("session");
          }}
        >
          By Session
        </Button>
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
          By Run
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
        <SessionDataSelector
          initialRows={
            initialSelection?.kind === "session"
              ? initialSelection.rows
              : undefined
          }
          onRowsChanged={handleSessionRowsChanged}
        />
      )}
    </div>
  );
}
