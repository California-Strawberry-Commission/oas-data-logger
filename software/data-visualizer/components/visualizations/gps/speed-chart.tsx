import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
  timestampS: number;
  speedMph: number;
};

/**
 * Smooth a speed time series using a time-aware Exponential Moving Average (EMA).
 *
 * The half-life is the amount of time (in seconds) it takes for a sudden change
 * in speed to be reflected by 50% in the smoothed output.
 *
 * @param data Speed samples sorted by timestamp (ascending).
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
    const dt = data[i].timestampS - data[i - 1].timestampS;
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
 * @param data Speed samples sorted by timestamp (ascending).
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

  const t0 = data[0].timestampS;
  const t1 = data[data.length - 1].timestampS;
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

    while (i < data.length && data[i].timestampS <= bucketEnd) {
      const s = data[i];
      if (!min || s.speedMph < min.speedMph) min = s;
      if (!max || s.speedMph > max.speedMph) max = s;
      i++;
    }

    if (min && max) {
      // Add in time order
      if (min.timestampS <= max.timestampS) {
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
    while (i < data.length && data[i].timestampS > bucketEnd) {
      bucketEnd += bucketW;
    }
    bucketEnd += bucketW;
  }

  // Keep endpoints
  const first = data[0];
  const last = data[data.length - 1];
  if (result.length === 0 || result[0].timestampS !== first.timestampS) {
    result.unshift(first);
  }
  if (result[result.length - 1].timestampS !== last.timestampS) {
    result.push(last);
  }

  // Sort and dedupe timestamps
  result.sort((a, b) => a.timestampS - b.timestampS);
  const dedupe: SpeedSample[] = [];
  for (const s of result) {
    if (
      dedupe.length === 0 ||
      dedupe[dedupe.length - 1].timestampS !== s.timestampS
    ) {
      dedupe.push(s);
    }
  }
  return dedupe;
}

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const speedChartConfig = {
  speedMph: {
    label: "Speed",
  },
} as const;

export default function SpeedChart({
  data,
  selectedTimestampS,
  onSelectedTimestampChange,
}: {
  data: SpeedSample[];
  selectedTimestampS?: number;
  onSelectedTimestampChange?: (timestampS: number) => void;
}) {
  const renderedData = useMemo(() => {
    // Smooth speed data to improve visualization since raw data is noisy
    const smoothed = smoothSpeedEma(data, 5);
    // Downsample points to improve performance since charts are very
    // expensive to render
    const maxChartPoints = 1000;
    return smoothed.length > maxChartPoints
      ? downsampleMinMaxByTime(
          smoothed,
          Math.max(1, Math.floor(maxChartPoints / 2)),
        )
      : smoothed;
  }, [data]);

  return (
    <ChartContainer config={speedChartConfig} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={renderedData}
          margin={{ top: 8, right: 12, bottom: 12, left: 0 }}
          onMouseMove={(state: any) => {
            if (!onSelectedTimestampChange) {
              return;
            }

            const payload = state?.activePayload?.[0]?.payload;
            onSelectedTimestampChange(
              payload && typeof payload.timestampS === "number"
                ? payload.timestampS
                : null,
            );
          }}
          onMouseLeave={() => onSelectedTimestampChange?.(0)}
        >
          <XAxis
            dataKey="timestampS"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => formatTime(Number(v))}
            minTickGap={24}
          >
            <Label
              value="Time"
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
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const ts = payload?.[0]?.payload?.timestampS;
                  if (typeof ts !== "number" || !Number.isFinite(ts)) {
                    return "";
                  }
                  return formatTime(ts);
                }}
                formatter={(value) => `${Number(value).toFixed(1)} mph`}
              />
            }
          />

          {selectedTimestampS !== undefined && selectedTimestampS > 0 && (
            <ReferenceLine x={selectedTimestampS} strokeWidth={1} />
          )}

          <Line
            type="monotone"
            dataKey="speedMph"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
