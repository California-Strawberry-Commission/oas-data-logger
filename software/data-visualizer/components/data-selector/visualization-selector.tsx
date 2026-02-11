"use client";

import Combobox from "@/components/ui/combobox";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  STREAM_ID_LATITUDE,
  STREAM_ID_LONGITUDE,
} from "@/components/visualizations/gps-visualization";

export enum VisualizationType {
  NONE,
  GPS,
}

type RunMeta = {
  uuid: string;
  epochTimeS: bigint;
  tickBaseUs: bigint;
  streams: Stream[];
  isActive?: boolean;
};

type Stream = {
  streamId: string;
  streamType: string;
  count: number;
};

function hasGpsData(run: RunMeta): boolean {
  const streamIds = new Set(run.streams.map((s) => s.streamId));
  return (
    streamIds.has(STREAM_ID_LATITUDE) && streamIds.has(STREAM_ID_LONGITUDE)
  );
}

export default function VisualizationSelector({
  runUuid,
  value,
  onValueChange,
}: {
  runUuid: string;
  value: VisualizationType;
  onValueChange: (viz: VisualizationType) => void;
}) {
  const [run, setRun] = useState<RunMeta | null>(null);

  const fetchRunMeta = useCallback(async () => {
    const res = await fetch(`/api/runs/${runUuid}`);
    const data = await res.json();

    const nextRun: RunMeta = {
      uuid: data.uuid,
      epochTimeS: BigInt(data.epochTimeS),
      tickBaseUs: BigInt(data.tickBaseUs),
      streams: data.streams,
      isActive: data.isActive,
    };

    setRun(nextRun);
  }, [runUuid]);

  // Initial fetch when runUuid changes
  useEffect(() => {
    if (!runUuid) {
      return;
    }
    setRun(null);
    fetchRunMeta();
  }, [runUuid, fetchRunMeta]);

  const items = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    if (run && hasGpsData(run)) {
      out.push({ value: String(VisualizationType.GPS), label: "GPS position" });
    }
    return out;
  }, [run]);

  // Auto-select first available visualization
  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    // If current selection is empty or no longer valid, pick the first option
    const isValid = items.some((i) => Number(i.value) === value);
    if (!isValid) {
      onValueChange(Number(items[0].value) as VisualizationType);
    }
  }, [items, value, onValueChange]);

  const comboboxValue = value === VisualizationType.NONE ? "" : String(value);

  const comboboxOnValueChange = useCallback(
    (v: string) => {
      if (!v) {
        onValueChange(VisualizationType.NONE);
        return;
      }
      onValueChange(Number(v) as VisualizationType);
    },
    [onValueChange],
  );

  return (
    <>
      <div className="flex items-center gap-2">
        <Combobox
          items={items}
          value={comboboxValue}
          onValueChange={comboboxOnValueChange}
          placeholder={"Select visualization..."}
          searchPlaceholder={"Search visualization..."}
        />
        {run?.isActive && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            Live
          </span>
        )}
      </div>
    </>
  );
}
