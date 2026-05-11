"use client";

import type { SessionSelectionRow } from "@/components/data-selector/data-selector";
import SessionSelectionCard from "@/components/data-selector/session/session-selection-card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";

const MAX_ROWS = 4;

function createRow(): SessionSelectionRow {
  return { rowId: crypto.randomUUID(), device: null, sessionKey: "" };
}

export default function SessionDataSelector({
  initialRows,
  onRowsChanged,
}: {
  initialRows?: SessionSelectionRow[];
  onRowsChanged?: (rows: SessionSelectionRow[]) => void;
}) {
  const [rows, setRows] = useState<SessionSelectionRow[]>(() => [createRow()]);

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
    patch: Partial<Omit<SessionSelectionRow, "rowId">>,
  ) {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    );
  }
  function addRow() {
    posthog.capture("selection:session_comparison_added");
    setRows((prev) => [...prev, createRow()]);
  }
  function removeRow(rowId: string) {
    posthog.capture("selection:session_comparison_removed");
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((r) => r.rowId !== rowId),
    );
  }

  const primary = rows[0];
  const primaryHasSelection = !!primary?.device && !!primary?.sessionKey;
  const showAddComparison = primaryHasSelection && rows.length < MAX_ROWS;

  return (
    <>
      {rows.map((row, idx) => (
        <SessionSelectionCard
          key={row.rowId}
          index={idx}
          title={
            idx === 0
              ? rows.length > 1
                ? "Base"
                : undefined
              : `Comparison ${idx}`
          }
          device={row.device}
          sessionKey={row.sessionKey}
          onDeviceChange={(device) =>
            updateRow(row.rowId, { device, sessionKey: "" })
          }
          onSessionKeyChange={(sessionKey) =>
            updateRow(row.rowId, { sessionKey })
          }
          onRemove={idx === 0 ? undefined : () => removeRow(row.rowId)}
        />
      ))}

      {primaryHasSelection && (
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
        </>
      )}
    </>
  );
}
