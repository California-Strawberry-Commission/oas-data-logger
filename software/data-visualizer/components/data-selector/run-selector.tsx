"use client";

import Combobox, { type Group } from "@/components/ui/combobox";
import { useDeviceRuns, type Run } from "@/lib/api";
import posthog from "posthog-js";
import { useEffect, useMemo } from "react";

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
  const timeStr = startTime.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });

  if (run.isActive) {
    const secsSinceLastData = (Date.now() - lastDataTime.getTime()) / 1000;
    return `🟢 ${timeStr} (Active - ${formatTimeDiff(secsSinceLastData)}) <${run.uuid}>`;
  }
  return `${timeStr} (${formatDuration(run.durationS)}) <${run.uuid}>`;
}

// Converts Unix timestamp into YYYY-MM-DD in local time
function getDayKey(epochTimeS: number): string {
  const date = new Date(epochTimeS * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // months are 0-indexed
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

  const groups: Group[] | undefined = useMemo(() => {
    if (!deviceId || isLoading || error) {
      return undefined;
    }

    const now = new Date();
    const todayKey = getDayKey(Math.floor(now.getTime() / 1000));
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDayKey(Math.floor(yesterday.getTime() / 1000));

    const groupMap = new Map<string, Run[]>();
    for (const run of sortedRuns) {
      const key = getDayKey(run.epochTimeS);
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(run);
    }

    return Array.from(groupMap.entries()).map(([key, groupRuns]) => {
      let groupHeading = "";
      if (key === todayKey) {
        groupHeading = "Today";
      } else if (key === yesterdayKey) {
        groupHeading = "Yesterday";
      } else {
        const [year, month, day] = key.split("-").map(Number); // day key is YYYY-MM-DD
        groupHeading = new Date(year, month - 1, day).toLocaleDateString(
          "en-US",
          {
            month: "short",
            day: "numeric",
            year: "numeric",
          },
        );
      }
      return {
        heading: groupHeading,
        items: groupRuns.map((run) => ({
          value: run.uuid,
          label: getRunLabel(run),
        })),
      };
    });
  }, [deviceId, isLoading, error, sortedRuns]);

  const placeholderItems = useMemo(() => {
    if (!deviceId) {
      return [{ value: "__no_device__", label: "Select a device first" }];
    }
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading runs..." }];
    }
    if (error) {
      return [{ value: "__error__", label: "Failed to load runs" }];
    }
    return [];
  }, [deviceId, isLoading, error]);

  return (
    <Combobox
      items={placeholderItems}
      groups={groups}
      value={value}
      onValueChange={(next) => {
        // Ignore placeholder items
        if (next.startsWith("__")) {
          return;
        }

        const run = sortedRuns.find((r) => r.uuid === next) ?? null;
        posthog.capture("selection:run_selected", {
          run_uuid: run?.uuid,
          is_active: run?.isActive,
        });
        onValueChange(run);
      }}
      placeholder={isLoading ? "Loading runs..." : "Select run..."}
      searchPlaceholder={isLoading ? "Loading..." : "Search run..."}
      disabled={placeholderItems.length > 0}
    />
  );
}
