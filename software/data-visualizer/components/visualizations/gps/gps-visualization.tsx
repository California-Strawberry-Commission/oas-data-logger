"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  distanceMeters,
  MAX_JUMP_METERS,
  MILES_TO_METERS,
  MIN_NUM_SATELLITES,
  STREAM_ID_ALTITUDE,
  STREAM_ID_LATITUDE,
  STREAM_ID_LONGITUDE,
  STREAM_ID_SATELLITES,
  STREAM_ID_WIFI_RSSI,
  toDwellMinsSamples,
  toMapPoints,
  toSpeedMphSamples,
  type MapPoint,
} from "@/components/visualizations/gps/gps-processing";
import type { Track } from "@/components/visualizations/gps/map";
import RunSummaryCard, {
  type RunSummary,
} from "@/components/visualizations/gps/run-summary-card";
import TimeSeriesChart, {
  type TimeSeries,
} from "@/components/visualizations/gps/time-series-chart";
import { useRunStreamsMany, type Run } from "@/lib/api";
import { formatElapsed } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

// Lazy load Map
const MapComponent = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <LoadingMap />,
});

export type RunWithColor = {
  run: Run;
  color?: string;
};

function LoadingMap() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500 animate-pulse">Loading...</span>
    </div>
  );
}

function NoDataMap() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500">No data</span>
    </div>
  );
}

function ErrorMap({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500">Error: {msg}</span>
    </div>
  );
}

export default function GpsVisualization({ runs }: { runs: RunWithColor[] }) {
  // TODO: Be able to toggle filter through UI
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [selectedElapsedS, setSelectedElapsedS] = useState<number | null>(null);

  // Dedupe runs
  const filteredRuns: RunWithColor[] = useMemo(() => {
    const seen = new Set<string>();
    const result: RunWithColor[] = [];
    for (const r of runs) {
      const runUuid = r.run.uuid;
      if (!runUuid) {
        continue;
      }
      if (seen.has(runUuid)) {
        continue;
      }
      seen.add(runUuid);
      result.push(r);
    }
    return result;
  }, [runs]);

  const runUuids: string[] = useMemo(
    () => filteredRuns.map((r) => r.run.uuid),
    [filteredRuns],
  );

  // Fetch each run's GPS streams
  const { anyLoading, firstError, dataByUuid } = useRunStreamsMany(runUuids, [
    STREAM_ID_SATELLITES,
    STREAM_ID_LATITUDE,
    STREAM_ID_LONGITUDE,
    STREAM_ID_ALTITUDE,
    STREAM_ID_WIFI_RSSI,
  ]);

  // Build rawPointsByRun from query results
  const rawPointsByRun = useMemo(() => {
    const result: Record<string, MapPoint[]> = {};

    for (const r of filteredRuns) {
      const run = r.run;
      const data = dataByUuid[run.uuid];
      if (!data) {
        continue;
      }

      const mapPoints = toMapPoints(data, run.tickBaseUs);
      mapPoints.sort((a, b) => a.elapsedS - b.elapsedS);
      result[run.uuid] = mapPoints;
    }
    return result;
  }, [filteredRuns, dataByUuid]);

  // Filter outliers from raw GPS data
  const filteredPointsByRun = useMemo(() => {
    const result: Record<string, MapPoint[]> = {};

    for (const [uuid, points] of Object.entries(rawPointsByRun)) {
      if (!filterEnabled) {
        result[uuid] = points;
        continue;
      }

      let lastKept: MapPoint | null = null;
      const filtered: MapPoint[] = [];
      for (const point of points) {
        if (point.numSatellites < MIN_NUM_SATELLITES) {
          continue;
        }

        if (lastKept) {
          const jump = distanceMeters(lastKept.position, point.position);
          if (jump > MAX_JUMP_METERS) {
            continue;
          }
        }

        filtered.push(point);
        lastKept = point;
      }

      result[uuid] = filtered;
    }

    return result;
  }, [rawPointsByRun, filterEnabled]);

  const tracks: Track[] = useMemo(() => {
    return filteredRuns
      .map((r) => ({
        id: r.run.uuid,
        epochTimeS: r.run.epochTimeS,
        points: filteredPointsByRun[r.run.uuid] ?? [],
        color: r.color,
      }))
      .filter((t) => t.points.length > 0);
  }, [filteredRuns, filteredPointsByRun]);

  const { speedMphSeries, dwellMinsSeries } = useMemo(() => {
    const speedMphSeries: TimeSeries[] = [];
    const dwellMinsSeries: TimeSeries[] = [];

    for (const r of filteredRuns) {
      const points = filteredPointsByRun[r.run.uuid];
      if (!points || points.length === 0) {
        continue;
      }

      const speeds = toSpeedMphSamples(points);
      speedMphSeries.push({
        id: r.run.uuid,
        samples: speeds,
        color: r.color,
      });

      const dwell = toDwellMinsSamples(points, speeds);
      dwellMinsSeries.push({
        id: r.run.uuid,
        samples: dwell,
        color: r.color,
      });
    }

    return { speedMphSeries, dwellMinsSeries };
  }, [filteredRuns, filteredPointsByRun]);

  const runSummaries: RunSummary[] = useMemo(() => {
    return filteredRuns
      .map((r) => {
        const points = filteredPointsByRun[r.run.uuid];
        if (points == null || points.length === 0) {
          return null;
        }

        let totalDistanceMi = 0;
        for (let i = 1; i < points.length; i++) {
          totalDistanceMi +=
            distanceMeters(points[i - 1].position, points[i].position) /
            MILES_TO_METERS;
        }

        const speedSamples =
          speedMphSeries.find((series) => series.id === r.run.uuid)?.samples ??
          [];
        const speedValues = speedSamples.map((s) => s.value);
        const maxSpeedMph =
          speedValues.length > 0 ? Math.max(...speedValues) : 0;
        const avgSpeedMph =
          speedValues.length > 0
            ? speedValues.reduce((a, b) => a + b, 0) / speedValues.length
            : 0;

        const dwellSamples =
          dwellMinsSeries.find((d) => d.id === r.run.uuid)?.samples ?? [];
        const maxDwellMins =
          dwellSamples.length > 0
            ? Math.max(...dwellSamples.map((d) => d.value))
            : 0;

        return {
          run: r.run,
          color: r.color,
          totalDistanceMi,
          maxSpeedMph,
          avgSpeedMph,
          maxDwellMins,
        };
      })
      .filter((runSummary) => runSummary !== null);
  }, [filteredRuns, filteredPointsByRun, speedMphSeries, dwellMinsSeries]);

  if (firstError) {
    return (
      <div className="w-full h-150">
        <ErrorMap
          msg={
            firstError instanceof Error
              ? firstError.message
              : "Failed to load run(s)"
          }
        />
      </div>
    );
  }

  // No runs selected
  if (filteredRuns.length === 0) {
    return (
      <div className="w-full h-150">
        <NoDataMap />
      </div>
    );
  }

  // Still fetching data
  if (anyLoading) {
    return (
      <div className="w-full h-150">
        <LoadingMap />
      </div>
    );
  }

  // Data fetched, but nothing to render
  if (tracks.length === 0) {
    return (
      <div className="w-full h-150">
        <NoDataMap />
      </div>
    );
  }

  return (
    <>
      {runSummaries.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {runSummaries.map((runSummary) => (
            <RunSummaryCard key={runSummary.run.uuid} summary={runSummary} />
          ))}
        </div>
      )}
      <div className="w-full h-150 border rounded-md overflow-hidden">
        <MapComponent
          tracks={tracks}
          selectedElapsedS={selectedElapsedS ?? 0}
          onSelectedElapsedChange={setSelectedElapsedS}
        />
      </div>
      <Card className="w-full h-60">
        <CardContent className="w-full h-full">
          <TimeSeriesChart
            data={speedMphSeries}
            selectedElapsedS={selectedElapsedS ?? undefined}
            onSelectedElapsedChange={setSelectedElapsedS}
            yAxisLabel="Speed (mph)"
            yAxisLabelOffset={25}
            tooltipValueFormatter={(v) => `${v.toFixed(1)} mph`}
            smooth
            smoothingHalfLifeS={2}
          />
        </CardContent>
      </Card>
      <Card className="w-full h-60">
        <CardContent className="w-full h-full">
          <TimeSeriesChart
            data={dwellMinsSeries}
            selectedElapsedS={selectedElapsedS ?? undefined}
            onSelectedElapsedChange={setSelectedElapsedS}
            yAxisLabel="Dwell time (minutes)"
            yAxisLabelOffset={50}
            tooltipValueFormatter={(v) => `${formatElapsed(v * 60)}`}
          />
        </CardContent>
      </Card>
    </>
  );
}
