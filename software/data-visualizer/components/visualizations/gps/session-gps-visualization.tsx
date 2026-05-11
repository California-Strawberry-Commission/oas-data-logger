"use client";

import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/visualizations/gps/gps-processing";
import type { Track } from "@/components/visualizations/gps/map";
import {
  computeFilteredPointsByRun,
  ErrorMap,
  LoadingMap,
  NoDataMap,
} from "@/components/visualizations/gps/run-gps-visualization";
import SessionSummaryCard, {
  type SessionSummary,
} from "@/components/visualizations/gps/session-summary-card";
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

export type Session = {
  sessionKey: string;
  color: string;
  runs: Run[];
  device?: Device;
};

export default function SessionGpsVisualization({
  sessions,
}: {
  sessions: Session[];
}) {
  const [selectedElapsedS, setSelectedElapsedS] = useState<number | null>(null);

  // Collect all run UUIDs across all sessions for a single batched fetch for stream data
  const allRuns = useMemo(() => sessions.flatMap((s) => s.runs), [sessions]);
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

  // Create one Track per run so runs within the same session are not connected.
  // All runs within the same session share the same color.
  const tracks: Track[] = useMemo(() => {
    const result: Track[] = [];
    for (const session of sessions) {
      if (session.runs.length === 0) {
        continue;
      }

      const firstRunEpochS = session.runs[0].epochTimeS;
      for (const run of session.runs) {
        const timeOffset = run.epochTimeS - firstRunEpochS;
        const points = (filteredPointsByRun[run.uuid] ?? []).map((p) => ({
          ...p,
          elapsedS: p.elapsedS + timeOffset,
        }));
        if (points.length > 0) {
          result.push({
            id: run.uuid,
            epochTimeS: run.epochTimeS,
            points,
            color: session.color,
          });
        }
      }
    }
    return result;
  }, [sessions, filteredPointsByRun]);

  // Create one TimeSeries per run so runs within the same session are not
  // connected in the charts. All runs within the same session share the same color.
  const { speedMphSeries, dwellMinsSeries } = useMemo(() => {
    const speedMphSeries: TimeSeries[] = [];
    const dwellMinsSeries: TimeSeries[] = [];

    for (const session of sessions) {
      if (session.runs.length === 0) {
        continue;
      }

      const firstRunEpochS = session.runs[0].epochTimeS;

      for (const run of session.runs) {
        const points = filteredPointsByRun[run.uuid];
        if (!points || points.length === 0) {
          continue;
        }

        const timeOffset = run.epochTimeS - firstRunEpochS;

        const speeds = toSpeedMphSamples(points).map((s) => ({
          ...s,
          elapsedS: s.elapsedS + timeOffset,
        }));
        if (speeds.length > 0) {
          speedMphSeries.push({
            id: `speed-${session.sessionKey}-${run.uuid}`,
            samples: speeds,
            color: session.color,
          });
        }

        const dwells = toDwellMinsSamples(
          points,
          toSpeedMphSamples(points),
        ).map((s) => ({ ...s, elapsedS: s.elapsedS + timeOffset }));
        if (dwells.length > 0) {
          dwellMinsSeries.push({
            id: `dwell-${session.sessionKey}-${run.uuid}`,
            samples: dwells,
            color: session.color,
          });
        }
      }
    }

    return { speedMphSeries, dwellMinsSeries };
  }, [sessions, filteredPointsByRun]);

  // Calculate summary metrics for each session
  const sessionSummaries: SessionSummary[] = useMemo(() => {
    const result: SessionSummary[] = [];
    for (const session of sessions) {
      if (session.runs.length === 0) {
        continue;
      }

      let totalDistanceMi = 0;
      let totalDurationS = 0;

      for (const run of session.runs) {
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

      const speedValues = speedMphSeries
        .filter((s) => s.id.startsWith(`speed-${session.sessionKey}-`))
        .flatMap((s) => s.samples.map((sample) => sample.value));
      const maxSpeedMph = speedValues.length > 0 ? Math.max(...speedValues) : 0;
      const avgSpeedMph =
        speedValues.length > 0
          ? speedValues.reduce((a, b) => a + b, 0) / speedValues.length
          : 0;

      result.push({
        sessionKey: session.sessionKey,
        epochTimeS: session.runs[0].epochTimeS,
        color: session.color,
        deviceName: session.device?.name ?? session.device?.id,
        runCount: session.runs.length,
        totalDistanceMi,
        maxSpeedMph,
        avgSpeedMph,
        totalDurationS,
      });
    }
    return result;
  }, [sessions, filteredPointsByRun, speedMphSeries]);

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

  const isSingleSession = sessions.length === 1;
  const firstSessionEpochS = sessions[0]?.runs[0]?.epochTimeS ?? 0;

  return (
    <>
      {sessionSummaries.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {sessionSummaries.map((s) => (
            <SessionSummaryCard
              key={`${s.sessionKey}-${s.color}`}
              summary={s}
            />
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
            xAxisLabel={isSingleSession ? "Time of Day" : "Elapsed Time"}
            xAxisTickFormatter={
              isSingleSession
                ? (v) => formatTimeOfDay(firstSessionEpochS + v)
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
            xAxisLabel={isSingleSession ? "Time of Day" : "Elapsed Time"}
            xAxisTickFormatter={
              isSingleSession
                ? (v) => formatTimeOfDay(firstSessionEpochS + v)
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
