"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import GpsVisualization from "@/components/visualizations/gps/gps-visualization";
import { type Run } from "@/lib/api";

export default function VisualizationArea({
  selection,
}: {
  selection: Selection;
}) {
  const runs = selection.runs
    .map((r) => r.run)
    .filter((run): run is Run => !!run);

  if (runs.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground p-4 text-center">
        Select a run.
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full items-center p-4 gap-4 md:overflow-y-auto">
      <GpsVisualization runs={runs} />
    </div>
  );
}
