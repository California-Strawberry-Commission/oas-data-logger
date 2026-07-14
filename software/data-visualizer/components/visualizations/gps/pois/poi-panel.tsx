"use client";

import { POI_LUCIDE_ICON } from "@/components/visualizations/gps/map-icons";
import type { Poi, PoiGroup } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  MapPin,
  Pencil,
  Plus,
  Trash,
} from "lucide-react";
import { useState } from "react";

function PoiRow({
  poi,
  hidden,
  onFocus,
  onToggle,
  onEdit,
  onDelete,
  indented = false,
}: {
  poi: Poi;
  hidden: boolean;
  onFocus: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  indented?: boolean;
}) {
  const Icon = POI_LUCIDE_ICON[poi.icon] ?? POI_LUCIDE_ICON["pin"];
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-1 hover:bg-black/5",
        indented && "pl-7",
      )}
    >
      <button
        type="button"
        title="Center map"
        onClick={onFocus}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 text-left",
          hidden && "text-muted-foreground line-through",
        )}
      >
        <Icon
          size={14}
          strokeWidth={2}
          color={poi.color}
          className="shrink-0"
        />
        <span className="truncate">{poi.name}</span>
      </button>
      <button
        type="button"
        title={hidden ? "Show" : "Hide"}
        onClick={onToggle}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/10"
      >
        {hidden ? (
          <EyeOff className="h-3 w-3 text-muted-foreground" />
        ) : (
          <Eye className="h-3 w-3" />
        )}
      </button>
      <button
        type="button"
        title="Edit"
        onClick={onEdit}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/10"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        title="Delete"
        onClick={onDelete}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/10"
      >
        <Trash className="h-3 w-3" />
      </button>
    </div>
  );
}

export function PoiPanel({
  pois,
  groups,
  hiddenPoiIds,
  hiddenGroupIds,
  onTogglePoiVisibility,
  onToggleGroupVisibility,
  onStartPlacePoi,
  onFocusPoi,
  onEditPoi,
  onEditGroup,
  onDeletePoi,
  onDeleteGroup,
}: {
  pois: Poi[];
  groups: PoiGroup[];
  hiddenPoiIds: Set<string>;
  hiddenGroupIds: Set<string>;
  onTogglePoiVisibility: (id: string) => void;
  onToggleGroupVisibility: (id: string) => void;
  onStartPlacePoi: () => void;
  onFocusPoi: (poi: Poi) => void;
  onEditPoi: (poi: Poi) => void;
  onEditGroup: (group: PoiGroup) => void;
  onDeletePoi: (id: string) => void;
  onDeleteGroup: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set(),
  );

  const ungroupedPois = pois.filter((p) => !p.groupId);

  function toggleGroupExpanded(groupId: string) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <div className="absolute right-2 top-2 z-1000 rounded bg-white/90 shadow text-xs w-48">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 font-semibold">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          POIs
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Add POI"
            onClick={onStartPlacePoi}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-black/10"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-black/10"
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isOpen && (
        <div className="border-t pb-1">
          {/* Grouped POIs */}
          {groups.map((group) => {
            const groupPois = pois.filter((p) => p.groupId === group.id);
            const isExpanded = expandedGroupIds.has(group.id);
            const isGroupHidden = hiddenGroupIds.has(group.id);

            return (
              <div key={group.id}>
                {/* Group row */}
                <div className="flex items-center gap-1 px-2 py-1 hover:bg-black/5">
                  <button
                    type="button"
                    onClick={() => toggleGroupExpanded(group.id)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </button>
                  <span
                    className={cn(
                      "flex-1 truncate",
                      isGroupHidden && "text-muted-foreground line-through",
                    )}
                  >
                    {group.name}
                    {groupPois.length > 0 && (
                      <span className="ml-1 text-muted-foreground">
                        ({groupPois.length})
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    title={isGroupHidden ? "Show group" : "Hide group"}
                    onClick={() => onToggleGroupVisibility(group.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/10"
                  >
                    {isGroupHidden ? (
                      <EyeOff className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => onEditGroup(group)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/10"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => onDeleteGroup(group.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/10"
                  >
                    <Trash className="h-3 w-3" />
                  </button>
                </div>

                {/* POI rows within group */}
                {isExpanded &&
                  groupPois.map((poi) => (
                    <PoiRow
                      key={poi.id}
                      poi={poi}
                      hidden={hiddenPoiIds.has(poi.id)}
                      onFocus={() => onFocusPoi(poi)}
                      onToggle={() => onTogglePoiVisibility(poi.id)}
                      onEdit={() => onEditPoi(poi)}
                      onDelete={() => onDeletePoi(poi.id)}
                      indented
                    />
                  ))}
              </div>
            );
          })}

          {/* Ungrouped POIs */}
          {ungroupedPois.length > 0 && (
            <>
              {groups.length > 0 && (
                <div className="px-3 py-1 text-muted-foreground">Ungrouped</div>
              )}
              {ungroupedPois.map((poi) => (
                <PoiRow
                  key={poi.id}
                  poi={poi}
                  hidden={hiddenPoiIds.has(poi.id)}
                  onFocus={() => onFocusPoi(poi)}
                  onToggle={() => onTogglePoiVisibility(poi.id)}
                  onEdit={() => onEditPoi(poi)}
                  onDelete={() => onDeletePoi(poi.id)}
                />
              ))}
            </>
          )}

          {/* Empty state */}
          {pois.length === 0 && groups.length === 0 && (
            <div className="px-3 py-2 text-muted-foreground">
              Click <Plus className="inline h-3 w-3" /> then anywhere on the map
              to add a point
            </div>
          )}
        </div>
      )}
    </div>
  );
}
