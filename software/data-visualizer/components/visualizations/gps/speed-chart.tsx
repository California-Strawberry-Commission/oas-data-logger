import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Label,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

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
  data: { timestampS: number; speedMph: number }[];
  selectedTimestampS?: number;
  onSelectedTimestampChange?: (timestampS: number) => void;
}) {
  return (
    <ChartContainer config={speedChartConfig} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
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
