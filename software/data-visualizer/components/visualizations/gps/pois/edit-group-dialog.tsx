"use client";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdatePoiGroup, type PoiGroup } from "@/lib/api";
import { AlertCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

export default function EditGroupDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: PoiGroup | null;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const updateGroup = useUpdatePoiGroup();

  // Pre-populate group name on open
  useEffect(() => {
    if (!open) {
      return;
    }

    setName(group?.name ?? "");
    setError("");
  }, [open, group]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!group) {
      return;
    }

    setError("");
    try {
      await updateGroup.mutateAsync({ id: group.id, input: { name } });
      onOpenChange(false);
    } catch {
      setError("Failed to rename group");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-90" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Rename Group</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateGroup.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateGroup.isPending}>
              {updateGroup.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
