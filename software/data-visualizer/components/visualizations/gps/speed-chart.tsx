import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { useMemo } from "react";
import {
  Label,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export type SpeedSample = {
  elapsedS: number;
  speedMph: number;
};

export type SpeedSeries = {
  id: string;
  samples: SpeedSample[];
  color?: string;
};

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

/**
 * Find the SpeedSample whose elapsedS is closest to targetElapsedS.
 * Uses binary search and assumes the input array is already sorted by
 * `elapsedS` in ascending order.
 *
 * @param points Time-sorted GPS points.
 * @param targetElapsedS Target elapsedS in seconds.
 * @returns Index of the closest point, or null if targetElapsedS lies outside of samples.
 */
function findClosestSample(
  samples: SpeedSample[],
  targetElapsedS: number,
): SpeedSample | null {
  if (
    samples.length === 0 ||
    targetElapsedS < samples[0].elapsedS ||
    targetElapsedS > samples[samples.length - 1].elapsedS
  ) {
    return null;
  }

  let lo = 0;
  let hi = samples.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].elapsedS < targetElapsedS) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (lo === 0) {
    return samples[0];
  }

  const prev = lo - 1;
  const d0 = Math.abs(samples[lo].elapsedS - targetElapsedS);
  const d1 = Math.abs(samples[prev].elapsedS - targetElapsedS);
  return d1 <= d0 ? samples[prev] : samples[lo];
}

/**
 * Smooth a speed time series using a time-aware Exponential Moving Average (EMA).
 *
 * The half-life is the amount of time (in seconds) it takes for a sudden change
 * in speed to be reflected by 50% in the smoothed output.
 *
 * @param data Speed samples sorted by elapsedS (ascending).
 * @param halfLifeS The half-life, in seconds.
 * @returns Smoothed speed data series.
 */
function smoothSpeedEma(
  data: SpeedSample[],
  halfLifeS: number = 5,
): SpeedSample[] {
  if (data.length === 0) {
    return [];
  }

  const result: SpeedSample[] = [];
  let speedMph = data[0].speedMph;
  result.push({ ...data[0], speedMph });

  const ln2 = Math.log(2);

  for (let i = 1; i < data.length; i++) {
    const dt = data[i].elapsedS - data[i - 1].elapsedS;
    // If dt is weird, fall back to no smoothing step.
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

    // Convert half-life to per-step alpha (time-aware)
    const alpha = safeDt > 0 ? 1 - Math.exp(-(ln2 * safeDt) / halfLifeS) : 1;

    speedMph = speedMph + alpha * (data[i].speedMph - speedMph);
    result.push({ ...data[i], speedMph });
  }

  return result;
}

/**
 * Downsample a time-series by dividing the time span into buckets and
 * keeping the minimum and maximum value from each bucket. This method
 * dramatically reduces point count while preserving overall shape,
 * peaks and spikes, and start/stop behavior. This works better than uniform
 * subsampling to preserve spikes and short events.
 *
 * @param data Speed samples sorted by elapsedS (ascending).
 * @param maxBuckets Number of time buckets (roughly half of the target point count).
 * @returns Downsampled speed samples.
 */
function downsampleMinMaxByTime(
  data: SpeedSample[],
  maxBuckets: number,
): SpeedSample[] {
  if (data.length === 0) {
    return [];
  }
  if (data.length <= maxBuckets * 2) {
    return data;
  }
  if (maxBuckets < 1) {
    return [data[0]];
  }

  const t0 = data[0].elapsedS;
  const t1 = data[data.length - 1].elapsedS;
  const span = t1 - t0;
  if (!Number.isFinite(span) || span <= 0) {
    return data;
  }

  const bucketW = span / maxBuckets;

  const result: SpeedSample[] = [];
  let bucketEnd = t0 + bucketW;

  let i = 0;
  while (i < data.length) {
    let min: SpeedSample | null = null;
    let max: SpeedSample | null = null;

    while (i < data.length && data[i].elapsedS <= bucketEnd) {
      const s = data[i];
      if (!min || s.speedMph < min.speedMph) min = s;
      if (!max || s.speedMph > max.speedMph) max = s;
      i++;
    }

    if (min && max) {
      // Add in time order
      if (min.elapsedS <= max.elapsedS) {
        result.push(min);
        if (max !== min) {
          result.push(max);
        }
      } else {
        result.push(max);
        if (max !== min) {
          result.push(min);
        }
      }
    }

    // Advance buckets and handle gaps
    while (i < data.length && data[i].elapsedS > bucketEnd) {
      bucketEnd += bucketW;
    }
    bucketEnd += bucketW;
  }

  // Keep endpoints
  const first = data[0];
  const last = data[data.length - 1];
  if (result.length === 0 || result[0].elapsedS !== first.elapsedS) {
    result.unshift(first);
  }
  if (result[result.length - 1].elapsedS !== last.elapsedS) {
    result.push(last);
  }

  // Sort and dedupe elapsedS
  result.sort((a, b) => a.elapsedS - b.elapsedS);
  const dedupe: SpeedSample[] = [];
  for (const s of result) {
    if (
      dedupe.length === 0 ||
      dedupe[dedupe.length - 1].elapsedS !== s.elapsedS
    ) {
      dedupe.push(s);
    }
  }
  return dedupe;
}

const speedChartConfig = {
  speedMph: {
    label: "Speed",
  },
} as const;

type ChartPoint = {
  elapsedS: number;
  [k: string]: number; // dynamic keys for each series' sample data (needed by Recharts)
};

export default function SpeedChart({
  data,
  selectedElapsedS,
  onSelectedElapsedChange,
}: {
  data: SpeedSeries[];
  selectedElapsedS?: number;
  onSelectedElapsedChange?: (elapsedS: number) => void;
}) {
  // Prepare per-series rendered samples (smooth + downsample), and convert into
  // a Recharts-friendly array format.
  const { renderedData, chartPoints } = useMemo(() => {
    const cleaned = data
      .map(({ id, samples, color }) => ({
        id,
        samples: samples.slice().sort((a, b) => a.elapsedS - b.elapsedS),
        color,
      }))
      .filter((s) => s.samples.length > 0);

    const maxChartPoints = 1000;
    const renderedData = cleaned.map(({ id, samples, color }) => {
      // Smooth data to improve visualization since raw data is noisy
      const smoothed = smoothSpeedEma(samples, 5);
      // Downsample points to improve performance since charts are very
      // expensive to render
      const downsampled =
        smoothed.length > maxChartPoints
          ? downsampleMinMaxByTime(
              smoothed,
              Math.max(1, Math.floor(maxChartPoints / 2)),
            )
          : smoothed;

      return { id, samples: downsampled, color };
    });

    // renderedData looks like:
    // [ { id: "runA", samples: [...] },
    //   { id: "runB", samples: [...] }, ]
    // However, in order for Recharts to render multiple lines, the data
    // needs to be flattened into a single array in a specific format:
    // [ { elapsedS: 0, "runA": 0, "runB": 0 },
    //   { elapsedS: 1, "runA": 3.2, "runB": 2.7 },
    //   { elapsedS: 2, "runA": 5.1 },
    //   { elapsedS: 3, "runB": 6.4 }, ]

    // Build union of all elapsedS across all runs
    const tSet = new Set<number>();
    for (const r of renderedData) {
      for (const s of r.samples) {
        tSet.add(s.elapsedS);
      }
    }
    const allElapsedS = Array.from(tSet).sort((a, b) => a - b);

    // In order to look up the speeds for each run at every elapsedS,
    // we create a map of elapsedS->speed for every run
    const runToDataMap = new Map<string, Map<number, number>>();
    for (const series of renderedData) {
      const dataMap = new Map<number, number>();
      for (const sample of series.samples) {
        dataMap.set(sample.elapsedS, sample.speedMph);
      }
      runToDataMap.set(series.id, dataMap);
    }

    // Construct flattened array for Recharts
    const chartPoints: ChartPoint[] = allElapsedS.map((elapsedS) => {
      const chartPoint: ChartPoint = { elapsedS };
      for (const [id, data] of runToDataMap) {
        const val = data.get(elapsedS);
        if (val !== undefined) {
          chartPoint[id] = val;
        }
      }
      return chartPoint;
    });

    return { renderedData, chartPoints };
  }, [data]);

  return (
    <ChartContainer config={speedChartConfig} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartPoints}
          margin={{ top: 8, right: 12, bottom: 12, left: 0 }}
          onMouseMove={(state: any) => {
            if (!onSelectedElapsedChange) {
              return;
            }

            const payload = state?.activePayload?.[0]?.payload;
            onSelectedElapsedChange(
              payload && typeof payload.elapsedS === "number"
                ? payload.elapsedS
                : null,
            );
          }}
          onMouseLeave={() => onSelectedElapsedChange?.(0)}
        >
          <XAxis
            dataKey="elapsedS"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => formatElapsed(Number(v))}
            minTickGap={24}
          >
            <Label
              value="Elapsed"
              position="insideBottom"
              textAnchor="middle"
              offset={-6}
            />
          </XAxis>
          <YAxis width={42} tickFormatter={(v) => `${Math.round(Number(v))}`}>
            <Label
              value="Speed (mph)"
              angle={-90}
              position="insideLeft"
              textAnchor="middle"
              offset={10}
            />
          </YAxis>

          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active) {
                return null;
              }

              const hoveredElapsed = payload?.[0]?.payload?.elapsedS;
              if (
                typeof hoveredElapsed !== "number" ||
                !Number.isFinite(hoveredElapsed)
              ) {
                return null;
              }

              // Custom tooltip that looks up nearest values for all runs and color codes the labels
              return (
                <div className="rounded-lg border bg-background p-2 shadow-sm">
                  <div className="mb-1 text-xs text-muted-foreground">
                    {formatElapsed(hoveredElapsed)}
                  </div>

                  <div className="space-y-1">
                    {renderedData.map((series) => {
                      const closest = findClosestSample(
                        series.samples,
                        hoveredElapsed,
                      );
                      if (!closest) {
                        return null;
                      }

                      return (
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: series.color }}
                          />
                          <span className="tabular-nums text-xs">
                            {closest.speedMph.toFixed(1)} mph
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />

          {selectedElapsedS !== undefined && selectedElapsedS > 0 && (
            <ReferenceLine x={selectedElapsedS} strokeWidth={1} />
          )}

          {renderedData.map((series) => {
            return (
              <Line
                key={series.id}
                type="monotone"
                dataKey={series.id}
                dot={false}
                isAnimationActive={false}
                stroke={series.color}
                connectNulls={true}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
