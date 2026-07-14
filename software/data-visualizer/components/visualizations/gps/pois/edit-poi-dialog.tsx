"use client";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Combobox from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { POI_LUCIDE_ICON } from "@/components/visualizations/gps/map-icons";
import {
  useCreatePoi,
  useCreatePoiGroup,
  useUpdatePoi,
  type Poi,
  type PoiGroup,
} from "@/lib/api";
import { cn, SELECTION_COLORS } from "@/lib/utils";
import { AlertCircleIcon } from "lucide-react";
import posthog from "posthog-js";
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
  onOpenChange: (open: boolean, saved?: boolean) => void;
  poi?: Poi;
  initialLat?: number;
  initialLng?: number;
  groups: PoiGroup[];
}) {
  const isEdit = poi !== undefined;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("pin");
  const [color, setColor] = useState(SELECTION_COLORS[0]);
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
      setColor(SELECTION_COLORS[0]);
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

    // If a new group name was typed, create a new group (or reuse existing if name matches)
    const trimmedGroupName = newGroupName.trim();
    if (trimmedGroupName) {
      const matchingGroup = groups.find(
        (g) => g.name.toLowerCase() === trimmedGroupName.toLowerCase(),
      );
      if (matchingGroup) {
        groupId = matchingGroup.id;
      } else {
        try {
          const created = await createPoiGroup.mutateAsync({
            name: trimmedGroupName,
          });
          groupId = created.id;
        } catch {
          setError("Failed to create group");
          return;
        }
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
        posthog.capture("poi:updated");
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
        posthog.capture("poi:created", {
          icon,
          has_description: description.trim() !== "",
          has_group: groupId !== null,
        });
      }
      onOpenChange(false, true);
    } catch {
      setError("Failed to save point of interest");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => onOpenChange(open)}>
      <DialogContent className="sm:max-w-105" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Point of Interest" : "Add Point of Interest"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
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
            <Label htmlFor="poi-name">Name</Label>
            <Input
              id="poi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (required)"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="poi-description">Description</Label>
            <Input
              id="poi-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
            />
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex gap-2">
              {Object.entries(POI_LUCIDE_ICON).map(([key, IconComponent]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
                    icon === key
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
              {SELECTION_COLORS.map((preset) => (
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

          <div className="space-y-2">
            <Label>Group</Label>
            <Combobox
              items={[
                { value: "", label: "None" },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
              value={selectedGroupId}
              onValueChange={setSelectedGroupId}
              searchPlaceholder="Search groups..."
            />
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
