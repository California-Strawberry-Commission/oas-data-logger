"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import GpsVisualization from "@/components/visualizations/gps/gps-visualization";

export default function VisualizationArea({
  selection,
}: {
  selection: Selection;
}) {
  const runUuids = selection.runs
    .map((r) => r.runUuid)
    .filter((u): u is string => !!u);

  if (runUuids.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground p-4 text-center">
        Select a run.
      </div>
    );
  }

  // Render viz
  return (
    <div className="flex flex-col w-full items-center p-4 gap-4 md:overflow-y-auto">
      <GpsVisualization runUuids={runUuids} />
    </div>
  );
}
