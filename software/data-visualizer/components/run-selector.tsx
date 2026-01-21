"use client";

import Combobox from "@/components/ui/combobox";
import { useEffect, useState } from "react";

type Run = {
  uuid: string;
  epochTimeS: bigint;
  lastDataTimeS: bigint;
  isActive: boolean;
};

function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

function formatDuration(seconds: number): string {
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

function formatTimeDiff(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getRunLabel(run: Run): string {
  const startTime = new Date(Number(run.epochTimeS) * 1000);
  const lastDataTime = new Date(Number(run.lastDataTimeS) * 1000);

  if (run.isActive) {
    const now = new Date();
    const secsSinceLastData = (now.getTime() - lastDataTime.getTime()) / 1000;
    const timeAgoStr = formatTimeDiff(secsSinceLastData);
    return `🟢 ${formatDate(startTime)} (Active - ${timeAgoStr}) <${run.uuid}>`;
  } else {
    const durationS = (lastDataTime.getTime() - startTime.getTime()) / 1000;
    return `${formatDate(startTime)} (${formatDuration(durationS)}) <${run.uuid}>`;
  }
}

export default function RunSelector({
  deviceId,
  onSelect,
}: {
  deviceId: string;
  onSelect?: (runUuid: string) => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    fetch(`/api/runs?device_id=${deviceId}`)
      .then((res) => res.json())
      .then((data) => {
        console.log(data);
        const runs: Run[] = data.map((r: any) => ({
          uuid: r.uuid,
          epochTimeS: BigInt(r.epochTimeS),
          lastDataTimeS: BigInt(r.lastDataTimeS),
          isActive: r.isActive,
        }));
        const sorted = runs.sort((a: Run, b: Run) =>
          Number(b.epochTimeS - a.epochTimeS),
        );
        setRuns(sorted);
      });
  }, [deviceId]);

  const runItems = runs.map((run: Run) => {
    return {
      value: run.uuid,
      label: getRunLabel(run),
      isActive: run.isActive,
    };
  });

  return (
    <Combobox
      key={deviceId} // reset (unmount/remount) combobox when device changes
      items={runItems}
      placeholder={"Select run..."}
      searchPlaceholder={"Search run..."}
      onSelect={onSelect}
    />
  );
}
