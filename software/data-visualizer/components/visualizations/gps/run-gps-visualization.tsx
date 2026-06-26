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
import MapWithPois from "@/components/visualizations/gps/map-with-pois";
import RunSummaryCard, {
  type RunSummary,
} from "@/components/visualizations/gps/run-summary-card";
import TimeSeriesChart, {
  type TimeSeries,
} from "@/components/visualizations/gps/time-series-chart";
import {
  useRunStreamsMany,
  type Device,
  type Run,
  type RunDataSample,
} from "@/lib/api";
import { formatElapsed, formatTimeOfDay } from "@/lib/utils";
import { useMemo, useState } from "react";

export type RunWithColor = {
  run: Run;
  color?: string;
  device?: Device;
};

export function computeFilteredPointsByRun(
  runs: Run[],
  dataByUuid: Record<string, RunDataSample[]>,
): Record<string, MapPoint[]> {
  const result: Record<string, MapPoint[]> = {};
  for (const run of runs) {
    const data = dataByUuid[run.uuid];
    if (!data) {
      continue;
    }

    const points = toMapPoints(data, run.tickBaseUs);
    points.sort((a, b) => a.elapsedS - b.elapsedS);

    // Apply filtering
    let lastKept: MapPoint | null = null;
    const filtered: MapPoint[] = [];
    for (const point of points) {
      if (point.numSatellites < MIN_NUM_SATELLITES) {
        continue;
      }

      if (
        lastKept &&
        distanceMeters(lastKept.position, point.position) > MAX_JUMP_METERS
      ) {
        continue;
      }

      filtered.push(point);
      lastKept = point;
    }
    result[run.uuid] = filtered;
  }
  return result;
}

export function LoadingMap() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500 animate-pulse">Loading...</span>
    </div>
  );
}

export function NoDataMap() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500">No data</span>
    </div>
  );
}

export function ErrorMap({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500">Error: {msg}</span>
    </div>
  );
}

export default function RunGpsVisualization({
  runs,
}: {
  runs: RunWithColor[];
}) {
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

  const isLive = filteredRuns.some((r) => r.run.isActive);

  // Fetch GPS streams for all runs
  const { anyLoading, firstError, dataByUuid } = useRunStreamsMany(
    runUuids,
    [
      STREAM_ID_SATELLITES,
      STREAM_ID_LATITUDE,
      STREAM_ID_LONGITUDE,
      STREAM_ID_ALTITUDE,
      STREAM_ID_WIFI_RSSI,
    ],
    isLive,
  );

  const filteredPointsByRun = useMemo(
    () =>
      computeFilteredPointsByRun(
        filteredRuns.map((r) => r.run),
        dataByUuid,
      ),
    [filteredRuns, dataByUuid],
  );

  // Create a Track for each run
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

  // Calculate speed and dwell time time series for each run
  const { speedMphSeries, dwellMinsSeries } = useMemo(() => {
    const speedMphSeries: TimeSeries[] = [];
    const dwellMinsSeries: TimeSeries[] = [];

    for (const r of filteredRuns) {
      const points = filteredPointsByRun[r.run.uuid];
      if (!points || points.length === 0) {
        continue;
      }

      const speeds = toSpeedMphSamples(points);
      if (speeds.length > 0) {
        speedMphSeries.push({
          id: r.run.uuid,
          samples: speeds,
          color: r.color,
        });
      }

      const dwells = toDwellMinsSamples(points, speeds);
      if (dwells.length > 0) {
        dwellMinsSeries.push({
          id: r.run.uuid,
          samples: dwells,
          color: r.color,
        });
      }
    }

    return { speedMphSeries, dwellMinsSeries };
  }, [filteredRuns, filteredPointsByRun]);

  // Calculate summary metrics for each run
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
          deviceName: r.device?.name ?? r.device?.id,
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

  const isSingleRun = filteredRuns.length === 1;

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
        <MapWithPois
          tracks={tracks}
          selectedElapsedS={selectedElapsedS ?? undefined}
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
            xAxisLabel={isSingleRun ? "Time of Day" : "Elapsed Time"}
            xAxisTickFormatter={
              isSingleRun
                ? (v) => formatTimeOfDay(filteredRuns[0].run.epochTimeS + v)
                : (v) => formatElapsed(v)
            }
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
            xAxisLabel={isSingleRun ? "Time of Day" : "Elapsed Time"}
            xAxisTickFormatter={
              isSingleRun
                ? (v) => formatTimeOfDay(filteredRuns[0].run.epochTimeS + v)
                : (v) => formatElapsed(v)
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
