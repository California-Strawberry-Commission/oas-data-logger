"use client";

import DataSelector, {
  type Selection,
} from "@/components/data-selector/data-selector";
import VisualizationArea from "@/components/visualizations/visualization-area";
import { useDevices, useRuns } from "@/lib/api";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

// Expected URL search params:
//   ?view=run&rows=uuid1,uuid2,...
//   ?view=session&rows=sessionKey1,sessionKey2,...
// For sessions, sessionKey is the run UUID of the first run in the session.
function parseUrl(
  searchParams: URLSearchParams,
): { kind: "run" | "session"; rows: string[] } | null {
  const view = searchParams.get("view");
  const rawRows = searchParams.get("rows") ?? "";

  if (view === "run" || view === "session") {
    const runUuids = rawRows.split(",").filter(Boolean);
    return runUuids.length > 0 ? { kind: view, rows: runUuids } : null;
  }

  return null;
}

export default function MainContent() {
  const [selection, setSelection] = useState<Selection>({
    kind: "session",
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

  const runUuidsFromUrl = parsed ? parsed.rows : [];

  const { data: devices = [], isSuccess: devicesLoaded } = useDevices();
  const { data: runsFromUrl = [], isSuccess: runsFromUrlLoaded } =
    useRuns(runUuidsFromUrl);

  // Build initialSelection from the parsed URL. Rows are populated once the
  // required async data has loaded.
  const initialSelection = useMemo<Selection | undefined>(() => {
    if (!parsed) {
      return undefined;
    }

    if (!devicesLoaded || !runsFromUrlLoaded) {
      return { kind: parsed.kind, rows: [] };
    }

    if (parsed.kind === "run") {
      return {
        kind: "run",
        rows: parsed.rows.map((uuid) => {
          const run = runsFromUrl.find((r) => r.uuid === uuid) ?? null;
          return {
            rowId: crypto.randomUUID(),
            device: devices.find((d) => d.id === run?.deviceId) ?? null,
            run,
          };
        }),
      };
    } else {
      return {
        kind: "session",
        rows: parsed.rows.map((sessionKey) => {
          const run = runsFromUrl.find((r) => r.uuid === sessionKey) ?? null;
          return {
            rowId: crypto.randomUUID(),
            device: devices.find((d) => d.id === run?.deviceId) ?? null,
            sessionKey,
          };
        }),
      };
    }
  }, [parsed, devices, devicesLoaded, runsFromUrl, runsFromUrlLoaded]);

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
          .filter((r) => r.sessionKey)
          .map((r) => r.sessionKey)
          .join(",");
        router.replace(
          rowsStr ? `${pathname}?view=session&rows=${rowsStr}` : pathname,
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
        <VisualizationArea selection={selection} />
      </section>
    </>
  );
}
