"use client";

import DeviceSelector from "@/components/device-selector";
import RunSelector from "@/components/run-selector";
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
import VisualizationSelector from "@/components/visualization-selector";
import { useEffect, useState } from "react";

export default function DataSelector() {
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [selectedVisualization, setSelectedVisualization] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string>("");

  // Used to force RunSelector to refetch runs after deleting a run
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  // Clear selectedRun whenever the device changes
  useEffect(() => {
    setSelectedRun("");
  }, [selectedDevice]);

  async function handleDeleteRun() {
    if (!selectedRun) {
      return;
    }

    setIsDeleting(true);
    setDeleteErrorMsg("");

    try {
      const res = await fetch(`/api/runs/${selectedRun}`, {
        method: "DELETE",
      });

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
      setRunsRefreshKey((k) => k + 1); // refresh the run list
    } catch (e) {
      setDeleteErrorMsg(
        e instanceof Error ? e.message : "Failed to delete run",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <DeviceSelector
        value={selectedDevice}
        onValueChange={setSelectedDevice}
      />

      {selectedDevice && (
        <RunSelector
          // Forcing remount triggers a re-fetch when we bump runsRefreshKey
          key={`${selectedDevice}:${runsRefreshKey}`}
          deviceId={selectedDevice}
          value={selectedRun}
          onValueChange={setSelectedRun}
        />
      )}

      {selectedRun && (
        <VisualizationSelector
          runUuid={selectedRun}
          value={selectedVisualization}
          onValueChange={setSelectedVisualization}
        />
      )}

      {selectedRun && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive">Delete Run</Button>
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
      )}
    </>
  );
}
