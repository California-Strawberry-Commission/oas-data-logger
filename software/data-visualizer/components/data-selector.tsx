"use client";

import DeviceSelector from "@/components/device-selector";
import RunSelector from "@/components/run-selector";
import VisualizationSelector from "@/components/visualization-selector";
import { useEffect, useState } from "react";

export default function DataSelector() {
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [selectedRun, setSelectedRun] = useState<string>("");

  // Clear selectedRun whenever the device changes
  useEffect(() => {
    setSelectedRun("");
  }, [selectedDevice]);

  return (
    <>
      <DeviceSelector onSelect={(deviceId) => setSelectedDevice(deviceId)} />
      {selectedDevice && (
        <RunSelector
          deviceId={selectedDevice}
          onSelect={(runUuid) => setSelectedRun(runUuid)}
        />
      )}
      {selectedRun && <VisualizationSelector runUuid={selectedRun} />}
    </>
  );
}
