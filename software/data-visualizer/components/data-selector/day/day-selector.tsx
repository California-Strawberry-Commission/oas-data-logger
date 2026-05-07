"use client";

import Combobox from "@/components/ui/combobox";
import { useDeviceRuns } from "@/lib/api";
import { getDayKey } from "@/lib/day-utils";
import posthog from "posthog-js";
import { useMemo } from "react";

function formatDayLabel(dayKey: string, runCount: number): string {
  const now = new Date();
  const todayKey = getDayKey(Math.floor(now.getTime() / 1000));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getDayKey(Math.floor(yesterday.getTime() / 1000));

  const runWord = runCount === 1 ? "run" : "runs";

  if (dayKey === todayKey) {
    return `Today (${runCount} ${runWord})`;
  }
  if (dayKey === yesterdayKey) {
    return `Yesterday (${runCount} ${runWord})`;
  }
  const [year, month, day] = dayKey.split("-").map(Number);
  const label = new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${label} (${runCount} ${runWord})`;
}

export default function DaySelector({
  deviceId,
  value,
  onValueChange,
}: {
  deviceId: string;
  value: string;
  onValueChange?: (dayKey: string) => void;
}) {
  const { data: runs = [], isLoading, error } = useDeviceRuns(deviceId);

  const items = useMemo(() => {
    if (!deviceId || isLoading || error) {
      return [];
    }

    const groupMap = new Map<string, number>();
    for (const run of runs) {
      const key = getDayKey(run.epochTimeS);
      groupMap.set(key, (groupMap.get(key) ?? 0) + 1);
    }

    // Sort days newest first
    const sortedKeys = Array.from(groupMap.keys()).sort((a, b) =>
      b.localeCompare(a),
    );

    return sortedKeys.map((key) => ({
      value: key,
      label: formatDayLabel(key, groupMap.get(key)!),
    }));
  }, [deviceId, isLoading, error, runs]);

  const placeholderItems = useMemo(() => {
    if (!deviceId) {
      return [{ value: "__no_device__", label: "Select a device first" }];
    }
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading days..." }];
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

        posthog.capture("selection:day_selected", {
          day_key: next,
        });
        onValueChange?.(next);
      }}
      placeholder={isLoading ? "Loading days..." : "Select day..."}
      searchPlaceholder={isLoading ? "Loading..." : "Search day..."}
      disabled={placeholderItems.length > 0}
    />
  );
}
