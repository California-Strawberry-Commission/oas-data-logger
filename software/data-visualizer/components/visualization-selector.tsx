"use client";

import Combobox from "@/components/ui/combobox";
import { useEffect, useState } from "react";
import GpsPositionVisualization from "@/components/gps-position-visualization";

type Run = {
  uuid: string;
  epochTimeS: number;
  tickBaseUs: number;
  streams: Stream[];
  isActive?: boolean;
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

function renderVisualization(
  run: Run, 
  visualization: string, 
  refreshKey: number
) {
  switch (visualization) {
    case "gps":
      return (
        <GpsPositionVisualization
          key={refreshKey} // Force remount on refresh
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
  const [selectedVisualization, setSelectedVisualization] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!runUuid) {
      return;
    }

    // Function to check if run is active
    const checkRunStatus = async () => {
      const runsRes = await fetch('/api/runs');
      const runs = await runsRes.json();
      const currentRun = runs.find((r: any) => r.uuid === runUuid);
      return currentRun?.isActive || false;
    };

    // Function to fetch run data
    const fetchRunData = async () => {
      const res = await fetch(`/api/runs/${runUuid}`);
      const data: Run = await res.json();
      
      // Check if this run is active
      const isActive = await checkRunStatus();
      
      setRun({ ...data, isActive });
      
      // If active, trigger a refresh of the visualization
      if (isActive) {
        setRefreshKey(prev => prev + 1);
      }
    };

    // Initial fetch
    fetchRunData();

    // Set up polling if needed
    const pollInterval = setInterval(async () => {
      const isActive = await checkRunStatus();
      if (isActive) {
        fetchRunData();
      }
    }, 5000); // Poll every 5 seconds for active runs

    return () => clearInterval(pollInterval);
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
      <div className="flex items-center gap-2">
        <Combobox
          items={items}
          placeholder={"Select visualization..."}
          searchPlaceholder={"Search visualization..."}
          onSelect={(viz) => setSelectedVisualization(viz)}
          defaultSelected={items[0]?.value}
        />
        {run?.isActive && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            Live
          </span>
        )}
      </div>
      {run && renderVisualization(run, selectedVisualization, refreshKey)}
    </>
  );
}