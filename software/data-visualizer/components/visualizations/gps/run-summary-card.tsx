import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Run } from "@/lib/api";
import { formatElapsed } from "@/lib/utils";

export type RunSummary = {
  run: Run;
  color?: string;
  totalDistanceMi: number;
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

export default function RunSummaryCard({ summary }: { summary: RunSummary }) {
  const startTime = new Date(summary.run.epochTimeS * 1000).toLocaleString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    },
  );

  return (
    <Card className="min-w-44">
      <CardHeader>
        <CardTitle>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: summary.color }}
            aria-hidden
          />
          <span className="text-sm font-medium pl-2">{startTime}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <StatRow
            label="Duration"
            value={formatElapsed(summary.run.durationS)}
          />
          <StatRow
            label="Distance"
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
