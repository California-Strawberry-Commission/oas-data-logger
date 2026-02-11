"use client";

import Combobox from "@/components/ui/combobox";
import { useEffect, useMemo, useState } from "react";

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
  value,
  onValueChange,
}: {
  deviceId: string;
  value: string;
  onValueChange: (runUuid: string) => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/runs?device_id=${deviceId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) {
          return;
        }

        const runs: Run[] = data.map((r: any) => ({
          uuid: r.uuid,
          epochTimeS: BigInt(r.epochTimeS),
          lastDataTimeS: BigInt(r.lastDataTimeS),
          isActive: r.isActive,
        }));
        setRuns(runs.sort((a, b) => Number(b.epochTimeS - a.epochTimeS)));
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // If the selected run no longer exists, clear it
  useEffect(() => {
    if (value && !runs.some((r) => r.uuid === value)) {
      onValueChange("");
    }
  }, [value, runs, onValueChange]);

  const items = useMemo(
    () =>
      runs.map((run) => ({
        value: run.uuid,
        label: getRunLabel(run),
      })),
    [runs],
  );

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={"Select run..."}
      searchPlaceholder={"Search run..."}
    />
  );
}
