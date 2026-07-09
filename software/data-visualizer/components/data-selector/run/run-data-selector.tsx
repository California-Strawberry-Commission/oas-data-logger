"use client";

import type { RunSelectionRow } from "@/components/data-selector/data-selector";
import RunSelectionCard from "@/components/data-selector/run/run-selection-card";
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
import { useDeleteDeviceRun } from "@/lib/api";
import { Trash2 } from "lucide-react";
import posthog from "posthog-js";
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_ROWS = 6;

function createRow(): RunSelectionRow {
  return { rowId: crypto.randomUUID(), device: null, run: null };
}

export default function RunDataSelector({
  initialRows,
  onRowsChanged,
}: {
  initialRows?: RunSelectionRow[];
  onRowsChanged?: (rows: RunSelectionRow[]) => void;
}) {
  const [rows, setRows] = useState<RunSelectionRow[]>(() => [createRow()]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // One-time initialization of rows from initialRows. Only initializes when
  // initialRows is not empty.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !initialRows || initialRows.length === 0) {
      return;
    }
    initialized.current = true;
    setRows(initialRows);
  }, [initialRows]);

  // Publish selection changes to parent
  useEffect(() => {
    onRowsChanged?.(rows);
  }, [rows, onRowsChanged]);

  function updateRow(
    rowId: string,
    patch: Partial<Omit<RunSelectionRow, "rowId">>,
  ) {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    );
  }
  function addRow() {
    posthog.capture("selection:comparison_added");
    setRows((prev) => [...prev, createRow()]);
  }
  function removeRow(rowId: string) {
    posthog.capture("selection:comparison_removed");
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((r) => r.rowId !== rowId),
    );
  }

  const primary = rows[0];
  const primaryHasRun = !!primary?.run;
  const isCompareMode = rows.length > 1;
  const showDelete = primaryHasRun && !isCompareMode;
  const showAddComparison = primaryHasRun && rows.length < MAX_ROWS;

  const deleteRun = useDeleteDeviceRun(primary?.device?.id ?? "");
  const deleteErrorMsg = useMemo(() => {
    const err = deleteRun.error;
    return err instanceof Error
      ? err.message
      : err
        ? "Failed to delete run"
        : "";
  }, [deleteRun.error]);

  function handleDelete() {
    const runUuid = primary?.run?.uuid;
    if (!runUuid || !primary?.device?.id) {
      return;
    }

    posthog.capture("selection:run_deleted", { run_uuid: runUuid });
    deleteRun.mutate(runUuid, {
      onSuccess: () => {
        setDeleteOpen(false);
        setRows((prev) => {
          const next = [...prev];
          next[0] = { ...next[0], run: null };
          return next;
        });
      },
    });
  }

  return (
    <>
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
          {showAddComparison && (
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={addRow}
            >
              + Add comparison
            </Button>
          )}
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
                    onClick={handleDelete}
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
    </>
  );
}
