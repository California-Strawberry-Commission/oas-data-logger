import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export type Device = { id: string; name?: string };
export type Run = {
  uuid: string;
  deviceId: string;
  epochTimeS: number;
  durationS: number;
  tickBaseUs: number;
  isActive: boolean;
};
export type RunDataSample = {
  streamId: string;
  tick: number;
  data: unknown;
};

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function deleteRun(runUuid: string): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runUuid)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error(`Failed to delete run (${res.status})`);
  }
}

export const fetchDevices = () => getJSON<Device[]>("/api/devices");

export const fetchRuns = (deviceId: string) =>
  getJSON<Run[]>(`/api/devices/${encodeURIComponent(deviceId)}/runs`);

export const fetchRunStreams = (runUuid: string, streamIds: string[]) =>
  getJSON<RunDataSample[]>(
    `/api/runs/${encodeURIComponent(runUuid)}/streams?stream_ids=${encodeURIComponent(
      streamIds.join(","),
    )}`,
  );

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: fetchDevices,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useRuns(deviceId: string) {
  return useQuery({
    queryKey: ["runs", deviceId],
    queryFn: () => fetchRuns(deviceId),
    enabled: !!deviceId,
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useRunStreams(runUuid: string, streamIds: string[]) {
  // Note: streamIds must be stable and order-stable for a stable queryKey
  const streamKey = streamIds.join(",");
  return useQuery({
    queryKey: ["runStreams", runUuid, streamKey],
    queryFn: () => fetchRunStreams(runUuid, streamIds),
    enabled: !!runUuid && streamIds.length > 0,
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useRunStreamsMany(runUuids: string[], streamIds: string[]) {
  // Note: streamIds must be stable and order-stable for a stable queryKey
  const streamKey = streamIds.join(",");
  return useQueries({
    queries: runUuids.map((uuid) => ({
      queryKey: ["runStreams", uuid, streamKey],
      queryFn: () => fetchRunStreams(uuid, streamIds),
      enabled: !!uuid && runUuids.length > 0 && streamIds.length > 0,
      staleTime: 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
}

export function useDeleteRun(deviceId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: deleteRun,
    onSuccess: () => {
      // Invalidate useRuns query cache
      qc.invalidateQueries({ queryKey: ["runs", deviceId] });
    },
  });
}
