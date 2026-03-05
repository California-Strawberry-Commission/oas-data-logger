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
import { useDeleteRun, type Device, type Run } from "@/lib/api";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type RunSelectionRow = {
  rowId: string; // acts as stable key
  device: Device | null;
  run: Run | null;
};

export type Selection = {
  runs: RunSelectionRow[];
};

function createRow(): RunSelectionRow {
  return {
    rowId: crypto.randomUUID(),
    device: null,
    run: null,
  };
}

export default function DataSelector({
  onSelectionChanged,
}: {
  onSelectionChanged: (next: Selection) => void;
}) {
  const [rows, setRows] = useState<RunSelectionRow[]>(() => [createRow()]);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  const primaryHasRun = !!primary?.run;
  const isCompareMode = rows.length > 1;

  // Only show delete button when there is exactly one selected run
  const showDelete = !isCompareMode && primaryHasRun;

  const deleteRun = useDeleteRun(primary?.device?.id ?? "");
  const deleteErrorMsg = useMemo(() => {
    const err = deleteRun.error;
    return err instanceof Error
      ? err.message
      : err
        ? "Failed to delete run"
        : "";
  }, [deleteRun.error]);

  function handleDeletePrimaryRun() {
    const runUuid = primary?.run?.uuid;
    if (!runUuid || !primary?.device?.id) {
      return;
    }

    deleteRun.mutate(runUuid, {
      onSuccess: () => {
        // Close modal
        setDeleteOpen(false);

        // Clear primary run selection
        setRows((prev) => {
          const next = [...prev];
          next[0] = { ...next[0], run: null };
          return next;
        });
      },
    });
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {rows.map((row, idx) => (
        <RunSelectionCard
          key={row.rowId}
          index={idx}
          title={
            idx === 0
              ? isCompareMode
                ? "Base"
                : undefined
              : `Comparison ${idx}`
          }
          row={row}
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
                    disabled={deleteRun.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDeletePrimaryRun}
                    disabled={deleteRun.isPending}
                  >
                    {deleteRun.isPending ? "Deleting..." : "Confirm Delete"}
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
