import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

//#region General request helpers

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function patchJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function deleteResource(url: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

//#endregion

//#region Devices and runs

export type Device = { id: string; name?: string };
export type Run = {
  uuid: string;
  deviceId: string;
  epochTimeS: number;
  durationS: number;
  tickBaseUs: number;
  isActive: boolean;
  icon: string | null;
};
export type RunDataSample = {
  streamId: string;
  tick: number;
  data: unknown;
};
export type UpdateRunInput = { icon?: string | null };

const fetchDevices = () => getJSON<Device[]>("/api/devices");

const fetchDeviceRuns = (deviceId: string) =>
  getJSON<Run[]>(`/api/devices/${encodeURIComponent(deviceId)}/runs`);

const fetchRuns = (runUuids: string[]) =>
  getJSON<Run[]>(`/api/runs?uuids=${encodeURIComponent(runUuids.join(","))}`);

const fetchRunStreams = (runUuid: string, streamIds: string[]) =>
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
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}

export function useDeviceRuns(deviceId: string) {
  return useQuery({
    queryKey: ["deviceRuns", deviceId],
    queryFn: () => fetchDeviceRuns(deviceId),
    enabled: !!deviceId,
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}

export function useMultipleDeviceRuns(deviceIds: string[]) {
  return useQueries({
    queries: deviceIds.map((deviceId) => ({
      queryKey: ["deviceRuns", deviceId] as const,
      queryFn: () => fetchDeviceRuns(deviceId),
      enabled: !!deviceId,
      staleTime: 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchInterval: 60 * 1000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    })),
    combine: (results) => ({
      runsByDeviceId: Object.fromEntries(
        deviceIds.map((id, i) => [id, results[i]?.data ?? []]),
      ) as Record<string, Run[]>,
      anyLoading: results.some((r) => r.isLoading),
      firstError: results.find((r) => r.isError)?.error ?? null,
    }),
  });
}

export function useRuns(runUuids: string[]) {
  // Note: runUuids must be order-stable for a stable queryKey
  const uuidsKey = runUuids.join(",");
  return useQuery({
    queryKey: ["runs", uuidsKey],
    queryFn: () => fetchRuns(runUuids),
    enabled: runUuids.length > 0,
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}

export function useRunStreams(
  runUuid: string,
  streamIds: string[],
  isLive = false,
) {
  // Note: streamIds must be stable and order-stable for a stable queryKey
  const streamKey = streamIds.join(",");
  return useQuery({
    queryKey: ["runStreams", runUuid, streamKey],
    queryFn: () => fetchRunStreams(runUuid, streamIds),
    enabled: !!runUuid && streamIds.length > 0,
    staleTime: isLive ? 0 : 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: isLive ? 30 * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}

export function useRunStreamsMany(
  runUuids: string[],
  streamIds: string[],
  isLive = false,
) {
  // Note: streamIds must be stable and order-stable for a stable queryKey
  const streamKey = streamIds.join(",");
  return useQueries({
    queries: runUuids.map((runUuid) => ({
      queryKey: ["runStreams", runUuid, streamKey],
      queryFn: () => fetchRunStreams(runUuid, streamIds),
      enabled: runUuids.length > 0 && !!runUuid,
      staleTime: isLive ? 0 : 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchInterval: isLive ? 30 * 1000 : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    })),
    combine: (results) => {
      const anyLoading = results.some((r) => r.isLoading);
      const firstError = results.find((r) => r.isError)?.error;

      const dataByUuid: Record<string, RunDataSample[]> = {};
      for (let i = 0; i < results.length; i++) {
        const uuid = runUuids[i];
        const data = results[i]?.data;
        if (uuid && data !== undefined) {
          dataByUuid[uuid] = data;
        }
      }

      return {
        anyLoading,
        firstError,
        dataByUuid,
      };
    },
  });
}

export function useUpdateRun() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ uuid, input }: { uuid: string; input: UpdateRunInput }) =>
      patchJSON<Run>(`/api/runs/${encodeURIComponent(uuid)}`, input),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "runs" || q.queryKey[0] === "deviceRuns",
      });
    },
  });
}

export function useDeleteDeviceRun(deviceId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      deleteResource(`/api/runs/${encodeURIComponent(id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deviceRuns", deviceId] });
    },
  });
}

//#endregion

//#region Points of interest

export type Poi = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  icon: string;
  color: string;
  description: string;
  groupId: string | null;
};
export type PoiGroup = { id: string; name: string };
export type CreatePoiInput = {
  lat: number;
  lng: number;
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  groupId?: string | null;
};
export type UpdatePoiInput = Partial<CreatePoiInput>;
export type CreatePoiGroupInput = { name: string };
export type UpdatePoiGroupInput = Partial<CreatePoiGroupInput>;

export function usePois() {
  return useQuery({
    queryKey: ["pois"],
    queryFn: () => getJSON<Poi[]>("/api/pois"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePoiGroups() {
  return useQuery({
    queryKey: ["poiGroups"],
    queryFn: () => getJSON<PoiGroup[]>("/api/poi-groups"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreatePoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePoiInput) => postJSON<Poi>("/api/pois", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pois"] }),
  });
}

export function useUpdatePoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePoiInput }) =>
      patchJSON<Poi>(`/api/pois/${encodeURIComponent(id)}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pois"] }),
  });
}

export function useDeletePoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteResource(`/api/pois/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pois"] }),
  });
}

export function useCreatePoiGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePoiGroupInput) =>
      postJSON<PoiGroup>("/api/poi-groups", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["poiGroups"] }),
  });
}

export function useUpdatePoiGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePoiGroupInput }) =>
      patchJSON<PoiGroup>(`/api/poi-groups/${encodeURIComponent(id)}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["poiGroups"] }),
  });
}

export function useDeletePoiGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteResource(`/api/poi-groups/${encodeURIComponent(id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["poiGroups"] });
      qc.invalidateQueries({ queryKey: ["pois"] });
    },
  });
}

//#endregion
