"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import GpsVisualization, {
  type RunWithColor,
} from "@/components/visualizations/gps/gps-visualization";
import { type Run } from "@/lib/api";
import { colorForRunIndex } from "@/lib/utils";

export default function VisualizationArea({
  selection,
}: {
  selection: Selection;
}) {
  const runsWithColor: RunWithColor[] = selection.runs
    .map((r, idx) =>
      r.run ? { run: r.run, color: colorForRunIndex(idx) } : null,
    )
    .filter((x): x is { run: Run; color: string } => !!x);

  if (runsWithColor.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground p-4 text-center">
        Select a run.
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full items-center p-4 gap-4 md:overflow-y-auto">
      <GpsVisualization runs={runsWithColor} />
    </div>
  );
}
