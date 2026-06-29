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
import {
  POI_COLOR_PRESETS,
  POI_LUCIDE_ICON,
} from "@/components/visualizations/gps/pois/poi-icon";
import {
  useCreatePoi,
  useCreatePoiGroup,
  useUpdatePoi,
  type Poi,
  type PoiGroup,
  type PoiIcon,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { AlertCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

export default function EditPoiDialog({
  open,
  onOpenChange,
  poi,
  initialLat,
  initialLng,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poi?: Poi;
  initialLat?: number;
  initialLng?: number;
  groups: PoiGroup[];
}) {
  const isEdit = poi !== undefined;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<PoiIcon>("pin");
  const [color, setColor] = useState(POI_COLOR_PRESETS[0]);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState("");

  const createPoi = useCreatePoi();
  const updatePoi = useUpdatePoi();
  const createPoiGroup = useCreatePoiGroup();

  const isPending =
    createPoi.isPending || updatePoi.isPending || createPoiGroup.isPending;

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) {
      return;
    }

    setError("");
    setNewGroupName("");
    if (poi) {
      setName(poi.name);
      setDescription(poi.description);
      setIcon(poi.icon);
      setColor(poi.color);
      setLat(String(poi.lat));
      setLng(String(poi.lng));
      setSelectedGroupId(poi.groupId ?? "");
    } else {
      setName("");
      setDescription("");
      setIcon("pin");
      setColor(POI_COLOR_PRESETS[0]);
      setLat(initialLat !== undefined ? String(initialLat.toFixed(6)) : "");
      setLng(initialLng !== undefined ? String(initialLng.toFixed(6)) : "");
      setSelectedGroupId("");
    }
  }, [open, poi, initialLat, initialLng]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setError("Latitude and longitude must be valid numbers");
      return;
    }

    let groupId: string | null = selectedGroupId || null;

    // Create new group if a name was typed
    if (newGroupName.trim()) {
      try {
        const created = await createPoiGroup.mutateAsync({
          name: newGroupName.trim(),
        });
        groupId = created.id;
      } catch {
        setError("Failed to create group");
        return;
      }
    }

    try {
      if (isEdit) {
        await updatePoi.mutateAsync({
          id: poi.id,
          input: {
            lat: latNum,
            lng: lngNum,
            name,
            icon,
            color,
            description,
            groupId,
          },
        });
      } else {
        await createPoi.mutateAsync({
          lat: latNum,
          lng: lngNum,
          name,
          icon,
          color,
          description,
          groupId,
        });
      }
      onOpenChange(false);
    } catch {
      setError("Failed to save point of interest");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-105" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Point of Interest" : "Add Point of Interest"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="poi-name">Name</Label>
            <Input
              id="poi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Waypoint name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="poi-description">Description</Label>
            <Input
              id="poi-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex gap-2">
              {(
                Object.entries(POI_LUCIDE_ICON) as [
                  PoiIcon,
                  (typeof POI_LUCIDE_ICON)[PoiIcon],
                ][]
              ).map(([value, IconComponent]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIcon(value)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
                    icon === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <IconComponent className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {POI_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColor(preset)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform",
                    color === preset
                      ? "border-foreground scale-110"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: preset }}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="poi-lat">Latitude</Label>
              <Input
                id="poi-lat"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="0.000000"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="poi-lng">Longitude</Label>
              <Input
                id="poi-lng"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="0.000000"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="poi-group">Group</Label>
            <select
              id="poi-group"
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Or create new group..."
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
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
