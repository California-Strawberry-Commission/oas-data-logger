"use client";

import GpsPositionVisualization from "@/components/gps-position-visualization";
import Combobox from "@/components/ui/combobox";
import { useCallback, useEffect, useMemo, useState } from "react";

type Run = {
  uuid: string;
  epochTimeS: bigint;
  tickBaseUs: bigint;
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
  return (
    (streamIds.has("pos.lat") && streamIds.has("pos.lng")) ||
    (streamIds.has("gpsData.lat") && streamIds.has("gpsData.lng"))
  );
}

function renderVisualization(
  run: Run,
  visualization: string,
  refreshKey: number,
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
  value,
  onValueChange,
}: {
  runUuid: string;
  value: string;
  onValueChange: (viz: string) => void;
}) {
  const [run, setRun] = useState<Run>();
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchRunData = useCallback(async () => {
    const res = await fetch(`/api/runs/${runUuid}`);
    const data = await res.json();

    const nextRun: Run = {
      uuid: data.uuid,
      epochTimeS: BigInt(data.epochTimeS),
      tickBaseUs: BigInt(data.tickBaseUs),
      streams: data.streams,
      isActive: data.isActive,
    };

    setRun(nextRun);

    // If active, trigger a refresh of the visualization
    if (nextRun.isActive) {
      setRefreshKey((prev) => prev + 1);
    }
  }, [runUuid]);

  // Initial fetch when runUuid changes
  useEffect(() => {
    if (!runUuid) {
      return;
    }
    fetchRunData();
  }, [runUuid, fetchRunData]);

  // Set up polling for new data if the current run is active
  useEffect(() => {
    if (!runUuid || !run?.isActive) {
      return;
    }

    const pollInterval = setInterval(() => {
      fetchRunData();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [runUuid, run?.isActive, fetchRunData]);

  const items = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    if (run && hasGpsData(run)) {
      out.push({ value: "gps", label: "GPS position" });
    }
    return out;
  }, [run]);

  // Auto-select first available visualization (controlled)
  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    // If current selection is empty or no longer valid, pick the first option
    const isValid = value && items.some((i) => i.value === value);
    if (!isValid) {
      onValueChange(items[0].value);
    }
  }, [items, value, onValueChange]);

  return (
    <>
      <div className="flex items-center gap-2">
        <Combobox
          items={items}
          value={value}
          onValueChange={onValueChange}
          placeholder={"Select visualization..."}
          searchPlaceholder={"Search visualization..."}
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
      {run && renderVisualization(run, value, refreshKey)}
    </>
  );
}
