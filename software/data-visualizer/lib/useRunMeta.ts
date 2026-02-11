import { useCallback, useEffect, useState } from "react";

export type RunMeta = {
  uuid: string;
  epochTimeS: bigint;
  tickBaseUs: bigint;
  streams: Stream[];
  isActive?: boolean;
};

export type Stream = {
  streamId: string;
  streamType: string;
  count: number;
};

export default function useRunMeta(runUuid: string) {
  const [run, setRun] = useState<RunMeta | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(async () => {
    if (!runUuid) {
      return;
    }

    setError("");
    const res = await fetch(`/api/runs/${runUuid}`);
    if (!res.ok) {
      setRun(null);
      setError("Failed to load run");
      return;
    }

    const data = await res.json();
    const nextRun: RunMeta = {
      uuid: data.uuid,
      epochTimeS: BigInt(data.epochTimeS),
      tickBaseUs: BigInt(data.tickBaseUs),
      streams: data.streams,
      isActive: data.isActive,
    };

    setRun(nextRun);

    if (nextRun.isActive) {
      setRefreshKey((k) => k + 1);
    }
  }, [runUuid]);

  useEffect(() => {
    // Reset when run changes
    setRun(null);
    setError("");
    setRefreshKey(0);

    if (!runUuid) {
      return;
    }
    refetch();
  }, [runUuid, refetch]);

  return { run, error, refreshKey, refetch };
}
