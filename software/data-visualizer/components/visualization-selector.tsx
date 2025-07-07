"use client";

import Combobox from "@/components/ui/combobox";
import { useEffect, useState } from "react";
import GpsPositionVisualization from "@/components/gps-position-visualization";

type Run = {
  uuid: string;
  epochTimeS: number;
  tickBaseUs: number;
  streams: Stream[];
};

type Stream = {
  streamId: string;
  streamType: string;
  count: number;
};

function hasGpsData(run: Run): boolean {
  const streamIds = new Set(run.streams.map((s) => s.streamId));
  // Check for both old and new stream ID formats
  return (streamIds.has("pos.lat") && streamIds.has("pos.lng")) || 
         (streamIds.has("gpsData.lat") && streamIds.has("gpsData.lng"));
}

function renderVisualization(run: Run, visualization: string) {
  switch (visualization) {
    case "gps":
      return (
        <GpsPositionVisualization
          runUuid={run.uuid}
          epochTimeS={run.epochTimeS}
          tickBaseUs={run.tickBaseUs}
        />
      );
    default:
      return null;
  }
}

export default function VisualizationSelector({
  runUuid,
}: {
  runUuid: string;
}) {
  const [run, setRun] = useState<Run>();
  const [selectedVisualization, setSelectedVisualization] =
    useState<string>("");

  useEffect(() => {
    if (!runUuid) {
      return;
    }
    fetch(`/api/runs/${runUuid}`)
      .then((res) => res.json())
      .then((data: Run) => setRun(data));
  }, [runUuid]);

  // Auto-select the first available visualization when run data is loaded
  useEffect(() => {
    if (run && hasGpsData(run) && selectedVisualization === "") {
      setSelectedVisualization("gps");
    }
  }, [run, selectedVisualization]);

  const items = [];
  if (run && hasGpsData(run)) {
    items.push({ value: "gps", label: "GPS position" });
  }

  return (
    <>
      <Combobox
        items={items}
        placeholder={"Select visualization..."}
        searchPlaceholder={"Search visualization..."}
        onSelect={(viz) => setSelectedVisualization(viz)}
        defaultSelected={items[0]?.value}
      />
      {run && renderVisualization(run, selectedVisualization)}
    </>
  );
}