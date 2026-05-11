"use client";

import Combobox from "@/components/ui/combobox";
import { useDeviceRuns } from "@/lib/api";
import {
  formatElapsed,
  formatTimeAgo,
  groupRunsIntoSessions,
} from "@/lib/utils";
import posthog from "posthog-js";
import { useMemo } from "react";

function getSessionLabel(
  epochTimeS: number,
  durationS: number,
  runCount: number,
  isActive: boolean = false,
): string {
  const startTime = new Date(epochTimeS * 1000);
  const lastDataTime = new Date((epochTimeS + durationS) * 1000);
  const timeStr = startTime.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  const runWord = runCount === 1 ? "run" : "runs";

  if (isActive) {
    const secsSinceLastData = (Date.now() - lastDataTime.getTime()) / 1000;
    return `🟢 ${timeStr} (Active - ${formatTimeAgo(secsSinceLastData)}, ${runCount} ${runWord})`;
  }
  return `${timeStr} (${formatElapsed(durationS)}, ${runCount} ${runWord})`;
}

export default function SessionSelector({
  deviceId,
  value,
  onValueChange,
}: {
  deviceId: string;
  value: string;
  onValueChange?: (sessionKey: string) => void;
}) {
  const { data: runs = [], isLoading, error } = useDeviceRuns(deviceId);

  const items = useMemo(() => {
    if (!deviceId || isLoading || error) {
      return [];
    }

    const sessions = groupRunsIntoSessions(runs);

    // For each session (group of runs), the key is the UUID of the first run
    const sessionMap = new Map<
      string,
      {
        epochTimeS: number;
        durationS: number;
        runCount: number;
        isActive: boolean;
      }
    >();
    for (const runs of sessions) {
      const firstRun = runs[0];
      const lastRun = runs[runs.length - 1];
      sessionMap.set(firstRun.uuid, {
        epochTimeS: firstRun.epochTimeS,
        durationS: lastRun.epochTimeS + lastRun.durationS - firstRun.epochTimeS,
        runCount: runs.length,
        isActive: runs.some((run) => run.isActive),
      });
    }

    // Sort sessions by epoch time in decreasing order
    const sortedKeys = Array.from(sessionMap.keys()).sort(
      (a, b) => sessionMap.get(b)!.epochTimeS - sessionMap.get(a)!.epochTimeS,
    );
    return sortedKeys.map((key) => {
      const { epochTimeS, durationS, runCount } = sessionMap.get(key)!;
      return {
        value: key,
        label: getSessionLabel(epochTimeS, durationS, runCount),
      };
    });
  }, [deviceId, isLoading, error, runs]);

  const placeholderItems = useMemo(() => {
    if (!deviceId) {
      return [{ value: "__no_device__", label: "Select a device first" }];
    }
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading sessions..." }];
    }
    if (error) {
      return [{ value: "__error__", label: "Failed to load runs" }];
    }
    return [];
  }, [deviceId, isLoading, error]);

  return (
    <Combobox
      items={placeholderItems.length > 0 ? placeholderItems : items}
      value={value}
      onValueChange={(next) => {
        // Ignore placeholder items
        if (next.startsWith("__")) {
          return;
        }

        posthog.capture("selection:session_selected", {
          session_key: next,
        });
        onValueChange?.(next);
      }}
      placeholder={isLoading ? "Loading sessions..." : "Select session..."}
      searchPlaceholder={isLoading ? "Loading..." : "Search session..."}
      disabled={placeholderItems.length > 0}
    />
  );
}
