"use client";

import DataSelector, {
  type Selection,
} from "@/components/data-selector/data-selector";
import DayVisualizationArea from "@/components/visualizations/day-visualization-area";
import VisualizationArea from "@/components/visualizations/visualization-area";
import { useDevices, useRuns } from "@/lib/api";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

type ParsedUrl =
  | { kind: "run"; runUuids: string[] }
  | { kind: "day"; rows: Array<{ deviceId: string; dayKey: string }> }
  | null;

// Expected URL search params:
//   ?view=run&rows=uuid1,uuid2,...
//   ?view=day&rows=deviceId1:dayKey1,deviceId2:dayKey2,...
function parseUrl(searchParams: URLSearchParams): ParsedUrl {
  const view = searchParams.get("view");
  const rawRows = searchParams.get("rows") ?? "";

  if (view === "run") {
    const runUuids = rawRows.split(",").filter(Boolean);
    return runUuids.length > 0 ? { kind: "run", runUuids } : null;
  }

  if (view === "day") {
    const rows = rawRows
      .split(",")
      .filter(Boolean)
      .map((chunk) => {
        const colonIdx = chunk.indexOf(":");
        if (colonIdx === -1) {
          return null;
        }
        return {
          deviceId: chunk.slice(0, colonIdx),
          dayKey: chunk.slice(colonIdx + 1),
        };
      })
      .filter((r) => r !== null);
    return rows.length > 0 ? { kind: "day", rows } : null;
  }

  return null;
}

export default function MainContent() {
  const [selection, setSelection] = useState<Selection>({
    kind: "run",
    rows: [],
  });

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Parse URL once on mount
  const parsed = useMemo(
    () => parseUrl(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const runUuidsFromUrl = parsed?.kind === "run" ? parsed.runUuids : [];

  const { data: devices = [], isSuccess: devicesLoaded } = useDevices();
  const { data: runs = [], isSuccess: runsLoaded } = useRuns(runUuidsFromUrl);

  // Build initialSelection from the parsed URL. Rows are populated once the
  // required async data has loaded.
  const initialSelection = useMemo<Selection | undefined>(() => {
    if (!parsed) {
      return undefined;
    }

    if (parsed.kind === "run") {
      if (!devicesLoaded || !runsLoaded) {
        return { kind: "run", rows: [] };
      }
      return {
        kind: "run",
        rows: parsed.runUuids.map((uuid) => {
          const run = runs.find((r) => r.uuid === uuid) ?? null;
          return {
            rowId: crypto.randomUUID(),
            device: devices.find((d) => d.id === run?.deviceId) ?? null,
            run,
          };
        }),
      };
    }

    if (parsed.kind === "day") {
      if (!devicesLoaded) {
        return { kind: "day", rows: [] };
      }
      return {
        kind: "day",
        rows: parsed.rows.map(({ deviceId, dayKey }) => ({
          rowId: crypto.randomUUID(),
          device: devices.find((d) => d.id === deviceId) ?? null,
          dayKey,
        })),
      };
    }
  }, [parsed, devices, devicesLoaded, runs, runsLoaded]);

  const handleSelectionChanged = useCallback(
    (next: Selection) => {
      setSelection(next);

      // Update URL to match selection
      if (next.kind === "run") {
        const rowsStr = next.rows
          .filter((r) => r.run)
          .map((r) => r.run!.uuid)
          .join(",");
        router.replace(
          rowsStr ? `${pathname}?view=run&rows=${rowsStr}` : pathname,
          { scroll: false },
        );
      } else {
        const rowsStr = next.rows
          .filter((r) => r.device && r.dayKey)
          .map((r) => `${r.device!.id}:${r.dayKey}`)
          .join(",");
        router.replace(
          rowsStr ? `${pathname}?view=day&rows=${rowsStr}` : pathname,
          { scroll: false },
        );
      }
    },
    [pathname, router],
  );

  return (
    <>
      {/* Sidebar */}
      <aside className="w-full md:w-90 md:shrink-0 p-4 border-b md:border-b-0 md:border-r md:overflow-y-auto">
        <DataSelector
          initialSelection={initialSelection}
          onSelectionChanged={handleSelectionChanged}
        />
      </aside>

      {/* Main visualization area */}
      <section className="flex-1 md:min-w-0 md:min-h-0 md:overflow-y-auto">
        {selection.kind === "day" ? (
          <DayVisualizationArea rows={selection.rows} />
        ) : (
          <VisualizationArea selection={selection} />
        )}
      </section>
    </>
  );
}
