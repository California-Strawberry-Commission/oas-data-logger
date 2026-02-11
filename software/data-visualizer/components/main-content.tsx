"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import DataSelector from "@/components/data-selector/data-selector";
import { VisualizationType } from "@/components/data-selector/visualization-selector";
import VisualizationArea from "@/components/visualizations/visualization-area";
import { useMemo, useState } from "react";

export default function MainContent() {
  const [selection, setSelection] = useState<Selection>({
    deviceId: "",
    runUuid: "",
    visualizationType: VisualizationType.NONE,
  });

  const isSelectionValid = useMemo(() => {
    return (
      selection.deviceId !== "" &&
      selection.runUuid !== "" &&
      selection.visualizationType !== VisualizationType.NONE
    );
  }, [selection]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="w-90 shrink-0 p-4 border-r overflow-auto">
        <DataSelector onSelectionChanged={setSelection} />
      </aside>

      {/* Main visualization area */}
      <section className="flex-1 min-w-0 min-h-0 overflow-auto">
        {isSelectionValid ? (
          <VisualizationArea selection={selection} />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            Select a device, run, and visualization type.
          </div>
        )}
      </section>
    </>
  );
}
