"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import { VisualizationType } from "@/components/data-selector/visualization-selector";
import GpsVisualization from "@/components/visualizations/gps/gps-visualization";
import useRunMeta from "@/lib/useRunMeta";

export default function VisualizationArea({
  selection,
}: {
  selection: Selection;
}) {
  const isSelectionValid =
    selection.deviceId !== "" &&
    selection.runUuid !== "" &&
    selection.visualizationType !== VisualizationType.NONE;

  const { run, error, refreshKey } = useRunMeta(selection.runUuid);

  // No selection yet
  if (!isSelectionValid) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground p-4 text-center">
        Select a device, run, and visualization type.
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center text-destructive p-4 text-center">
        {error}
      </div>
    );
  }

  // Loading
  if (!run) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  // Render viz
  return (
    <div className="flex flex-col w-full items-center p-4 gap-4 md:overflow-y-auto">
      {selection.visualizationType === VisualizationType.GPS ? (
        <GpsVisualization
          key={refreshKey}
          runUuid={run.uuid}
          epochTimeS={run.epochTimeS}
          tickBaseUs={run.tickBaseUs}
        />
      ) : null}
    </div>
  );
}
