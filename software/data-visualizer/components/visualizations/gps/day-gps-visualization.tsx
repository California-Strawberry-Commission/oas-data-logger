"use client";

import { Card, CardContent } from "@/components/ui/card";
import DaySummaryCard, {
  type DaySummary,
} from "@/components/visualizations/gps/day-summary-card";
import {
  distanceMeters,
  MILES_TO_METERS,
  STREAM_ID_ALTITUDE,
  STREAM_ID_LATITUDE,
  STREAM_ID_LONGITUDE,
  STREAM_ID_SATELLITES,
  STREAM_ID_WIFI_RSSI,
  toDwellMinsSamples,
  toSpeedMphSamples,
  type MapPoint,
} from "@/components/visualizations/gps/gps-processing";
import type { Track } from "@/components/visualizations/gps/map";
import {
  computeFilteredPointsByRun,
  ErrorMap,
  LoadingMap,
  NoDataMap,
} from "@/components/visualizations/gps/run-gps-visualization";
import TimeSeriesChart, {
  type TimeSeries,
} from "@/components/visualizations/gps/time-series-chart";
import { useRunStreamsMany, type Device, type Run } from "@/lib/api";
import { formatElapsed, formatTimeOfDay } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

// Lazy load Map
const MapComponent = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <LoadingMap />,
});

export type DayGroup = {
  dayKey: string;
  color: string;
  runs: Run[];
  device?: Device;
};

export default function DayGpsVisualization({
  dayGroups,
}: {
  dayGroups: DayGroup[];
}) {
  const [selectedElapsedS, setSelectedElapsedS] = useState<number | null>(null);

  // Collect all run UUIDs across all groups for a single batched stream fetch
  const allRuns = useMemo(() => dayGroups.flatMap((g) => g.runs), [dayGroups]);
  const allRunUuids = useMemo(() => allRuns.map((r) => r.uuid), [allRuns]);

  // Fetch GPS streams for all runs
  const { anyLoading, firstError, dataByUuid } = useRunStreamsMany(
    allRunUuids,
    [
      STREAM_ID_SATELLITES,
      STREAM_ID_LATITUDE,
      STREAM_ID_LONGITUDE,
      STREAM_ID_ALTITUDE,
      STREAM_ID_WIFI_RSSI,
    ],
  );

  const filteredPointsByRun = useMemo(
    () => computeFilteredPointsByRun(allRuns, dataByUuid),
    [allRuns, dataByUuid],
  );

  // Create a Track for each DayGroup by concatenating all runs in the group
  const tracks: Track[] = useMemo(() => {
    const result: Track[] = [];
    for (const group of dayGroups) {
      if (group.runs.length === 0) {
        continue;
      }

      // When concatenating points from all runs, recalculate elapsedS to be relative
      // to the epoch time of the earliest run in the group. Note that group.runs is
      // already sorted by epochTimeS.
      const firstRunEpochS = group.runs[0].epochTimeS;
      const allPoints: MapPoint[] = group.runs.flatMap((run) => {
        const timeOffset = run.epochTimeS - firstRunEpochS;
        return (filteredPointsByRun[run.uuid] ?? []).map((p) => ({
          ...p,
          elapsedS: p.elapsedS + timeOffset,
        }));
      });
      allPoints.sort((a, b) => a.elapsedS - b.elapsedS);

      if (allPoints.length > 0) {
        result.push({
          id: `day-${group.dayKey}-${group.color}`,
          epochTimeS: firstRunEpochS,
          points: allPoints,
          color: group.color,
        });
      }
    }
    return result;
  }, [dayGroups, filteredPointsByRun]);

  // Calculate speed and dwell time time series for each DayGroup
  const { speedMphSeries, dwellMinsSeries } = useMemo(() => {
    const speedMphSeries: TimeSeries[] = [];
    const dwellMinsSeries: TimeSeries[] = [];

    for (const group of dayGroups) {
      if (group.runs.length === 0) {
        continue;
      }

      const firstRunEpochS = group.runs[0].epochTimeS;

      const groupSpeeds: TimeSeries["samples"] = [];
      const groupDwell: TimeSeries["samples"] = [];

      for (const run of group.runs) {
        const points = filteredPointsByRun[run.uuid];
        if (!points || points.length === 0) {
          continue;
        }

        const timeOffset = run.epochTimeS - firstRunEpochS;

        for (const s of toSpeedMphSamples(points)) {
          groupSpeeds.push({ ...s, elapsedS: s.elapsedS + timeOffset });
        }
        for (const s of toDwellMinsSamples(points, toSpeedMphSamples(points))) {
          groupDwell.push({ ...s, elapsedS: s.elapsedS + timeOffset });
        }
      }

      if (groupSpeeds.length > 0) {
        speedMphSeries.push({
          id: `speed-${group.dayKey}-${group.color}`,
          samples: groupSpeeds,
          color: group.color,
        });
      }
      if (groupDwell.length > 0) {
        dwellMinsSeries.push({
          id: `dwell-${group.dayKey}-${group.color}`,
          samples: groupDwell,
          color: group.color,
        });
      }
    }

    return { speedMphSeries, dwellMinsSeries };
  }, [dayGroups, filteredPointsByRun]);

  // Calculate summary metrics for each day group
  const daySummaries: DaySummary[] = useMemo(() => {
    const result: DaySummary[] = [];
    for (const group of dayGroups) {
      if (group.runs.length === 0) {
        continue;
      }

      let totalDistanceMi = 0;
      let totalDurationS = 0;

      for (const run of group.runs) {
        const points = filteredPointsByRun[run.uuid];
        if (!points || points.length === 0) {
          continue;
        }

        for (let i = 1; i < points.length; i++) {
          totalDistanceMi +=
            distanceMeters(points[i - 1].position, points[i].position) /
            MILES_TO_METERS;
        }
        totalDurationS += run.durationS;
      }

      const speedValues =
        speedMphSeries
          .find((s) => s.id === `speed-${group.dayKey}-${group.color}`)
          ?.samples.map((s) => s.value) ?? [];
      const maxSpeedMph = speedValues.length > 0 ? Math.max(...speedValues) : 0;
      const avgSpeedMph =
        speedValues.length > 0
          ? speedValues.reduce((a, b) => a + b, 0) / speedValues.length
          : 0;

      result.push({
        dayKey: group.dayKey,
        color: group.color,
        deviceName: group.device?.name ?? group.device?.id,
        runCount: group.runs.length,
        totalDistanceMi,
        maxSpeedMph,
        avgSpeedMph,
        totalDurationS,
      });
    }
    return result;
  }, [dayGroups, filteredPointsByRun, speedMphSeries]);

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

  if (allRuns.length === 0) {
    return (
      <div className="w-full h-150">
        <NoDataMap />
      </div>
    );
  }

  if (anyLoading) {
    return (
      <div className="w-full h-150">
        <LoadingMap />
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="w-full h-150">
        <NoDataMap />
      </div>
    );
  }

  const isSingleGroup = dayGroups.length === 1;
  const firstGroupEpochS = dayGroups[0]?.runs[0]?.epochTimeS ?? 0;

  return (
    <>
      {daySummaries.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {daySummaries.map((s) => (
            <DaySummaryCard key={`${s.dayKey}-${s.color}`} summary={s} />
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
            xAxisLabel={isSingleGroup ? "Time of Day" : "Elapsed Time"}
            xAxisTickFormatter={
              isSingleGroup
                ? (v) => formatTimeOfDay(firstGroupEpochS + v)
                : (v) => formatElapsed(v)
            }
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
            xAxisLabel={isSingleGroup ? "Time of Day" : "Elapsed Time"}
            xAxisTickFormatter={
              isSingleGroup
                ? (v) => formatTimeOfDay(firstGroupEpochS + v)
                : (v) => formatElapsed(v)
            }
            yAxisLabel="Dwell time (minutes)"
            yAxisLabelOffset={50}
            tooltipValueFormatter={(v) => `${formatElapsed(v * 60)}`}
          />
        </CardContent>
      </Card>
    </>
  );
}
