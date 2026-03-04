import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type Device = { id: string; name?: string };
export type Run = {
  uuid: string;
  epochTimeS: number;
  durationS: number;
  isActive: boolean;
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
