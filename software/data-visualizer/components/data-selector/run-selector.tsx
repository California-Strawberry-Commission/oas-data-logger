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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // No device selected yet
      if (!deviceId) {
        setRuns([]);
        setError("");
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError("");

        const res = await fetch(
          `/api/runs?device_id=${encodeURIComponent(deviceId)}`,
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch runs (${res.status})`);
        }

        const data = await res.json();
        if (cancelled) {
          return;
        }

        const runs: Run[] = data.map((r: any) => ({
          uuid: r.uuid,
          epochTimeS: BigInt(r.epochTimeS),
          lastDataTimeS: BigInt(r.lastDataTimeS),
          isActive: r.isActive,
        }));

        // Newest first
        runs.sort((a, b) => Number(b.epochTimeS - a.epochTimeS));
        setRuns(runs);
      } catch (e) {
        if (cancelled) {
          return;
        }
        setRuns([]);
        setError("Failed to load runs");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // If the selected run no longer exists, clear it
  useEffect(() => {
    if (!isLoading && value && !runs.some((r) => r.uuid === value)) {
      onValueChange("");
    }
  }, [value, runs, isLoading, onValueChange]);

  const items = useMemo(() => {
    if (!deviceId) {
      return [{ value: "__no_device__", label: "Select a device first" }];
    }
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading runs..." }];
    }
    if (error) {
      return [{ value: "__error__", label: error }];
    }
    return runs.map((run) => ({
      value: run.uuid,
      label: getRunLabel(run),
    }));
  }, [deviceId, isLoading, error, runs]);

  const hasPlaceholder = items.length > 0 && items[0].value.startsWith("__");

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next) => {
        // Ignore placeholder items
        if (next.startsWith("__")) {
          return;
        }
        onValueChange(next);
      }}
      placeholder={isLoading ? "Loading runs..." : "Select run..."}
      searchPlaceholder={isLoading ? "Loading..." : "Search run..."}
      disabled={hasPlaceholder}
    />
  );
}
