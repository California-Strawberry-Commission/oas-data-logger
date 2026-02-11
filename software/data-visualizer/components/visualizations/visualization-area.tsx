"use client";

import type { Selection } from "@/components/data-selector/data-selector";
import { VisualizationType } from "@/components/data-selector/visualization-selector";
import GpsVisualization from "@/components/visualizations/gps-visualization";
import { useCallback, useEffect, useMemo, useState } from "react";

type RunMeta = {
  uuid: string;
  epochTimeS: bigint;
  tickBaseUs: bigint;
  isActive?: boolean;
};

export default function VisualizationArea({
  selection,
}: {
  selection: Selection;
}) {
  const [run, setRun] = useState<RunMeta | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string>("");

  const runUuid = selection.runUuid;

  const fetchRunMeta = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/runs/${runUuid}`);
    if (!res.ok) {
      setRun(null);
      setError("Failed to load run");
      return;
    }

    const data = await res.json();
    const nextRun: RunMeta = {
      uuid: data.uuid,
      epochTimeS: BigInt(data.epochTimeS),
      tickBaseUs: BigInt(data.tickBaseUs),
      isActive: data.isActive,
    };

    setRun(nextRun);

    // If active, force visualization remount so it can reload any internal state
    if (nextRun.isActive) {
      setRefreshKey((k) => k + 1);
    }
  }, [runUuid]);

  // Initial fetch when runUuid changes
  useEffect(() => {
    if (!runUuid) {
      return;
    }
    setRun(null);
    setRefreshKey(0);
    fetchRunMeta();
  }, [runUuid, fetchRunMeta]);

  const content = useMemo(() => {
    if (!run) {
      return null;
    }

    switch (selection.visualizationType) {
      case VisualizationType.GPS:
        return (
          <GpsVisualization
            key={refreshKey}
            runUuid={run.uuid}
            epochTimeS={run.epochTimeS}
            tickBaseUs={run.tickBaseUs}
          />
        );

      default:
        return null;
    }
  }, [selection.visualizationType, run, refreshKey]);

  return (
    <div className="h-full w-full overflow-hidden">
      {error ? (
        <div className="h-full flex items-center justify-center text-destructive">
          {error}
        </div>
      ) : !run ? (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="flex flex-col h-full w-full items-center overflow-y-auto p-4 gap-4">
          {content}
        </div>
      )}
    </div>
  );
}
