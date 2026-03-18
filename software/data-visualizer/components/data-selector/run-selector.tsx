"use client";

import Combobox from "@/components/ui/combobox";
import { useDeviceRuns, type Run } from "@/lib/api";
import posthog from "posthog-js";
import { useEffect, useMemo } from "react";

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
  const startTime = new Date(run.epochTimeS * 1000);
  const lastDataTime = new Date((run.epochTimeS + run.durationS) * 1000);

  if (run.isActive) {
    const now = new Date();
    const secsSinceLastData = (now.getTime() - lastDataTime.getTime()) / 1000;
    const timeAgoStr = formatTimeDiff(secsSinceLastData);
    return `🟢 ${formatDate(startTime)} (Active - ${timeAgoStr}) <${run.uuid}>`;
  } else {
    return `${formatDate(startTime)} (${formatDuration(run.durationS)}) <${run.uuid}>`;
  }
}

export default function RunSelector({
  deviceId,
  value,
  onValueChange,
}: {
  deviceId: string;
  value: string;
  onValueChange: (run: Run | null) => void;
}) {
  const { data: runs = [], isLoading, error } = useDeviceRuns(deviceId);

  const sortedRuns = useMemo(() => {
    // Newest first by epochTimeS
    const copy = [...runs];
    copy.sort((a: Run, b: Run) => b.epochTimeS - a.epochTimeS);
    return copy;
  }, [runs]);

  // If the selected run no longer exists, clear it
  useEffect(() => {
    if (!deviceId) {
      return;
    }

    if (!isLoading && value && !sortedRuns.some((r) => r.uuid === value)) {
      onValueChange(null);
    }
  }, [deviceId, value, sortedRuns, isLoading, onValueChange]);

  const items = useMemo(() => {
    if (!deviceId) {
      return [{ value: "__no_device__", label: "Select a device first" }];
    }
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading runs..." }];
    }
    if (error) {
      return [{ value: "__error__", label: "Failed to load runs" }];
    }
    return sortedRuns.map((run) => ({
      value: run.uuid,
      label: getRunLabel(run),
    }));
  }, [deviceId, isLoading, error, sortedRuns]);

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

        const run = sortedRuns.find((r) => r.uuid === next) ?? null;
        posthog.capture("run_selected", {
          run_uuid: run?.uuid,
          is_active: run?.isActive,
        });
        onValueChange(run);
      }}
      placeholder={isLoading ? "Loading runs..." : "Select run..."}
      searchPlaceholder={isLoading ? "Loading..." : "Search run..."}
      disabled={hasPlaceholder}
    />
  );
}
