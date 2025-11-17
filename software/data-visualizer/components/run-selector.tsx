"use client";

import Combobox from "@/components/ui/combobox";
import { useEffect, useState } from "react";

type Run = {
  uuid: string;
  epochTimeS: bigint;
  lastDataTimeS: bigint;
  isActive: boolean;
};

function truncate(str: string, maxLength: number) {
  return str.length > maxLength ? str.slice(0, maxLength - 3) + "..." : str;
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

export default function RunSelector({
  onSelect,
}: {
  onSelect?: (runUuid: string) => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((data) => {
        const runs: Run[] = data.map((r: any) => ({
          uuid: r.uuid,
          epochTimeS: BigInt(r.epochTimeS),
          lastDataTimeS: BigInt(r.lastDataTimeS),
          isActive: r.isActive,
        }));
        const sorted = runs.sort((a: Run, b: Run) =>
          Number(b.epochTimeS - a.epochTimeS)
        );
        setRuns(sorted);
      });
  }, []);

  const runItems = runs.map((run: Run) => {
    const startTime = new Date(Number(run.epochTimeS) * 1000);
    const lastDataTimeDate = new Date(Number(run.lastDataTimeS) * 1000);
    const now = new Date();

    // Calculate time since last data
    const timeSinceLastData =
      (now.getTime() - lastDataTimeDate.getTime()) / 1000;
    const timeAgoStr = formatTimeDiff(timeSinceLastData);

    // Format the label
    let label = `${truncate(
      run.uuid,
      12
    )} - Started ${startTime.toLocaleString()}`;

    if (run.isActive) {
      label = `🟢 ${label} (Active - ${timeAgoStr})`;
    } else {
      const duration = Number(run.lastDataTimeS - run.epochTimeS);
      const durationMinutes = Math.floor(duration / 60);
      const durationSeconds = duration % 60;
      label = `${label} (${durationMinutes}m ${durationSeconds}s)`;
    }

    return {
      value: run.uuid,
      label,
      isActive: run.isActive,
    };
  });

  return (
    <Combobox
      items={runItems}
      placeholder={"Select run..."}
      searchPlaceholder={"Search run..."}
      onSelect={onSelect}
      defaultSelected={runItems[0]?.value}
    />
  );
}
