import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatElapsed } from "@/lib/utils";

export type SessionSummary = {
  sessionKey: string;
  epochTimeS: number;
  color?: string;
  deviceName?: string;
  isActive?: boolean;
  runCount: number;
  totalDistanceMi: number;
  totalDurationS: number;
  maxSpeedMph: number;
  avgSpeedMph: number;
  maxDwellMins: number;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </>
  );
}

export default function SessionSummaryCard({
  summary,
}: {
  summary: SessionSummary;
}) {
  const startTime = new Date(summary.epochTimeS * 1000).toLocaleString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    },
  );

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
          <span className="text-sm font-medium">{startTime}</span>
          {summary.isActive && (
            <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              Live
            </span>
          )}
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
          <StatRow
            label="Max dwell"
            value={formatElapsed(summary.maxDwellMins * 60)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
