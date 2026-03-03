"use client";

import RunSelectionCard from "@/components/data-selector/run-selection-card";
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

export type RunSelectionRow = {
  rowId: string; // acts as stable key
  deviceId: string;
  runUuid: string;
};

export type Selection = {
  runs: RunSelectionRow[];
};

function createRow(): RunSelectionRow {
  return {
    rowId: crypto.randomUUID(),
    deviceId: "",
    runUuid: "",
  };
}

export default function DataSelector({
  onSelectionChanged,
}: {
  onSelectionChanged: (next: Selection) => void;
}) {
  const [rows, setRows] = useState<RunSelectionRow[]>(() => [createRow()]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState("");
  // Used to force RunSelector to refetch runs after deleting a run
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  // Publish selection changes to parent
  useEffect(() => {
    onSelectionChanged({ runs: rows });
  }, [rows, onSelectionChanged]);

  function updateRow(
    rowId: string,
    patch: Partial<Omit<RunSelectionRow, "rowId">>,
  ) {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    );
  }

  function addNewRow() {
    setRows((prev) => [...prev, createRow()]);
  }

  function removeRow(rowId: string) {
    setRows((prev) => {
      if (prev.length === 1) {
        return prev;
      }
      return prev.filter((r) => r.rowId !== rowId);
    });
  }

  const primary = rows[0];
  const primaryHasRun = !!primary?.runUuid;
  const isCompareMode = rows.length > 1;

  // Only show delete button when there is exactly one selected run
  const showDelete = !isCompareMode && primaryHasRun;

  async function handleDeletePrimaryRun() {
    if (!primary?.runUuid) {
      return;
    }

    setIsDeleting(true);
    setDeleteErrorMsg("");

    try {
      const res = await fetch(`/api/runs/${primary.runUuid}`, {
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

      // Close delete run modal
      setDeleteOpen(false);

      // Clear primary run selection
      setRows((prev) => {
        const next = [...prev];
        next[0] = { ...next[0], runUuid: "" };
        return next;
      });

      // Force refetching updated list of runs
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
      {rows.map((row, idx) => (
        <RunSelectionCard
          key={row.rowId}
          title={idx === 0 ? undefined : `Comparison ${idx}`}
          row={row}
          runsRefreshKey={runsRefreshKey}
          onChange={(patch) => updateRow(row.rowId, patch)}
          onRemove={idx === 0 ? undefined : () => removeRow(row.rowId)}
        />
      ))}

      {primaryHasRun && (
        <>
          <Separator />

          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={addNewRow}
          >
            + Add comparison
          </Button>

          {showDelete && (
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
                    This will permanently delete the run and its associated
                    data. This action cannot be undone.
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
                    onClick={handleDeletePrimaryRun}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Confirm Delete"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </>
      )}
    </div>
  );
}
