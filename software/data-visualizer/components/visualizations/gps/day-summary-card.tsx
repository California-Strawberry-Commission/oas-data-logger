import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatElapsed } from "@/lib/utils";

export type DaySummary = {
  dayKey: string;
  color?: string;
  deviceName?: string;
  runCount: number;
  totalDistanceMi: number;
  maxSpeedMph: number;
  avgSpeedMph: number;
  totalDurationS: number;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </>
  );
}

export default function DaySummaryCard({ summary }: { summary: DaySummary }) {
  const [year, month, day] = summary.dayKey.split("-").map(Number);
  const dateLabel = new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const runWord = summary.runCount === 1 ? "run" : "runs";

  return (
    <Card className="min-w-44">
      <CardHeader>
        <CardTitle>
          {summary.color && (
            <span
              className="inline-block h-2.5 w-2.5 rounded-full mr-2"
              style={{ backgroundColor: summary.color }}
              aria-hidden
            />
          )}
          <span className="text-sm font-medium">{dateLabel}</span>
        </CardTitle>
        {summary.deviceName && (
          <CardDescription>{summary.deviceName}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <StatRow label="Runs" value={`${summary.runCount} ${runWord}`} />
          <StatRow
            label="Total duration"
            value={formatElapsed(summary.totalDurationS)}
          />
          <StatRow
            label="Total distance"
            value={`${summary.totalDistanceMi.toFixed(2)} mi`}
          />
          <StatRow
            label="Max speed"
            value={`${summary.maxSpeedMph.toFixed(1)} mph`}
          />
          <StatRow
            label="Avg speed"
            value={`${summary.avgSpeedMph.toFixed(1)} mph`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
