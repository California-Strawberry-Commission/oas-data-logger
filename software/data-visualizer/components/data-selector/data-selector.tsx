"use client";

import DeviceSelector from "@/components/data-selector/device-selector";
import RunSelector from "@/components/data-selector/run-selector";
import VisualizationSelector, {
  VisualizationType,
} from "@/components/data-selector/visualization-selector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export type Selection = {
  deviceId: string;
  runUuid: string;
  visualizationType: VisualizationType;
};

export default function DataSelector({
  onSelectionChanged,
}: {
  onSelectionChanged: (next: Selection) => void;
}) {
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [selectedVisualization, setSelectedVisualization] =
    useState<VisualizationType>(VisualizationType.NONE);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string>("");

  // Used to force RunSelector to refetch runs after deleting a run
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  // Clear run + viz whenever the device changes
  useEffect(() => {
    setSelectedRun("");
    setSelectedVisualization(VisualizationType.NONE);
  }, [selectedDevice]);

  // Publish selection changes
  useEffect(() => {
    onSelectionChanged({
      deviceId: selectedDevice,
      runUuid: selectedRun,
      visualizationType: selectedVisualization,
    });
  }, [selectedDevice, selectedRun, selectedVisualization, onSelectionChanged]);

  async function handleDeleteRun() {
    if (!selectedRun) {
      return;
    }

    setIsDeleting(true);
    setDeleteErrorMsg("");

    try {
      const res = await fetch(`/api/runs/${selectedRun}`, { method: "DELETE" });

      if (!res.ok) {
        let msg = "Failed to delete run";
        try {
          const data = await res.json();
          if (data?.error) {
            msg = data.error;
          }
        } catch {}
        throw new Error(msg);
      }

      setDeleteOpen(false);
      setSelectedRun(""); // unselect the run when successfully deleted
      setSelectedVisualization(VisualizationType.NONE);
      setRunsRefreshKey((k) => k + 1);
    } catch (e) {
      setDeleteErrorMsg(
        e instanceof Error ? e.message : "Failed to delete run",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="space-y-2">
        <div className="text-sm font-medium">Device</div>
        <DeviceSelector
          value={selectedDevice}
          onValueChange={setSelectedDevice}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="text-sm font-medium">Run</div>
        {selectedDevice ? (
          <RunSelector
            key={`${selectedDevice}:${runsRefreshKey}`}
            deviceId={selectedDevice}
            value={selectedRun}
            onValueChange={setSelectedRun}
          />
        ) : (
          <div className="rounded-md border border-dashed py-2 px-3 text-sm text-muted-foreground">
            Select a device to load runs.
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="text-sm font-medium">Visualization</div>
        {selectedRun ? (
          <VisualizationSelector
            runUuid={selectedRun}
            value={selectedVisualization}
            onValueChange={setSelectedVisualization}
          />
        ) : (
          <div className="rounded-md border border-dashed py-2 px-3 text-sm text-muted-foreground">
            Select a run to enable visualization options.
          </div>
        )}
      </div>

      {selectedRun && (
        <>
          <Separator />

          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button
                variant="destructive"
                className="w-full justify-start gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete run
              </Button>
            </DialogTrigger>

            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this run?</DialogTitle>
                <DialogDescription>
                  This will permanently delete the run and its associated data.
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>

              {deleteErrorMsg && (
                <p className="text-sm text-destructive">{deleteErrorMsg}</p>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteOpen(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteRun}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Confirm Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
