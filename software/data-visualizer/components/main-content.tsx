"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import DataSelector from "@/components/data-selector/data-selector";
import { VisualizationType } from "@/components/data-selector/visualization-selector";
import VisualizationArea from "@/components/visualizations/visualization-area";
import { useState } from "react";

export default function MainContent() {
  const [selection, setSelection] = useState<Selection>({
    deviceId: "",
    runUuid: "",
    visualizationType: VisualizationType.NONE,
  });

  return (
    <>
      {/* Sidebar */}
      <aside className="w-full md:w-90 md:shrink-0 p-4 border-b md:border-b-0 md:border-r md:overflow-y-auto">
        <DataSelector onSelectionChanged={setSelection} />
      </aside>

      {/* Main visualization area */}
      <section className="flex-1 md:min-w-0 md:min-h-0 md:overflow-y-auto">
        <VisualizationArea selection={selection} />
      </section>
    </>
  );
}
