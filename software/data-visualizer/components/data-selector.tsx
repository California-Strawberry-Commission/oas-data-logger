"use client";

import RunSelector from "@/components/run-selector";
import VisualizationSelector from "@/components/visualization-selector";
import { useState } from "react";

export default function DataSelector() {
  const [selectedRun, setSelectedRun] = useState<string>("");

  return (
    <>
      <RunSelector onSelect={(runUuid) => setSelectedRun(runUuid)} />
      {selectedRun && <VisualizationSelector runUuid={selectedRun} />}
    </>
  );
}
