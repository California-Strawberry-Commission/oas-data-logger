"use client";

import DataSelector, {
  type RunSelectionRow,
  type Selection,
} from "@/components/data-selector/data-selector";
import VisualizationArea from "@/components/visualizations/visualization-area";
import { useDevices, useRuns } from "@/lib/api";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

// Extract run UUIDs from search params
// Example: ?runs=runUuid1,runUuid2,...
function parseRunUuids(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("runs");
  if (!raw) {
    return [];
  }
  return raw.split(",").filter(Boolean);
}

export default function MainContent() {
  const [selection, setSelection] = useState<Selection>({ runs: [] });

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Parse search params for run UUIDs, once on mount
  const runUuidsFromUrl = useMemo(
    () => parseRunUuids(searchParams),
    // Only parse once on mount. searchParams reference is stable on initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { data: devices = [], isSuccess: devicesLoaded } = useDevices();
  const { data: runs = [], isSuccess: runsLoaded } = useRuns(runUuidsFromUrl);

  // Resolve URL run UUIDs to full objects once all data has loaded
  const initialRows = useMemo<RunSelectionRow[] | undefined>(() => {
    if (runUuidsFromUrl.length === 0) {
      return undefined;
    }
    if (!devicesLoaded || !runsLoaded) {
      return undefined;
    }

    return runUuidsFromUrl.map((uuid) => {
      const run = runs.find((r) => r.uuid === uuid) ?? null;
      return {
        rowId: crypto.randomUUID(),
        device: devices.find((d) => d.id === run?.deviceId) ?? null,
        run,
      };
    });
  }, [runUuidsFromUrl, devices, devicesLoaded, runs, runsLoaded]);

  const handleSelectionChanged = useCallback(
    (next: Selection) => {
      setSelection(next);

      // Update URL to match selection. Note that we only manage the `runs` param,
      // and we build the URL from scratch so that we can avoid depending on
      // searchParams (which would cause this callback to get recreated on
      // searchParams changing).
      const pairs = next.runs
        .filter((r) => r.run)
        .map((r) => r.run!.uuid)
        .join(",");

      const newUrl = pairs ? `${pathname}?runs=${pairs}` : pathname;
      router.replace(newUrl, { scroll: false });
    },
    [pathname, router],
  );

  return (
    <>
      {/* Sidebar */}
      <aside className="w-full md:w-90 md:shrink-0 p-4 border-b md:border-b-0 md:border-r md:overflow-y-auto">
        <DataSelector
          initialRows={initialRows}
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
