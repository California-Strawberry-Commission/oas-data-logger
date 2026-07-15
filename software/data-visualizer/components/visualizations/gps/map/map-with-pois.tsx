"use client";

import type { Track } from "@/components/visualizations/gps/map/map";
import EditGroupDialog from "@/components/visualizations/gps/pois/edit-group-dialog";
import EditPoiDialog from "@/components/visualizations/gps/pois/edit-poi-dialog";
import { PoiPanel } from "@/components/visualizations/gps/pois/poi-panel";
import { LoadingMap } from "@/components/visualizations/gps/run-gps-visualization";
import {
  useDeletePoi,
  useDeletePoiGroup,
  usePoiGroups,
  usePois,
  type Poi,
  type PoiGroup,
} from "@/lib/api";
import dynamic from "next/dynamic";
import posthog from "posthog-js";
import { useMemo, useState } from "react";

// Lazy load Map
const MapComponent = dynamic(
  () => import("@/components/visualizations/gps/map/map"),
  {
    ssr: false,
    loading: () => <LoadingMap />,
  },
);

function toggleSet(s: Set<string>, id: string): Set<string> {
  const next = new Set(s);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export default function MapWithPois({
  tracks,
  playbackDurationS,
  selectedElapsedS,
  onSelectedElapsedChange,
}: {
  tracks: Track[];
  playbackDurationS?: number;
  selectedElapsedS?: number;
  onSelectedElapsedChange?: (elapsedS: number) => void;
}) {
  // hiddenPoiIds and hiddenGroupIds are set via PoiPanel, and used to determine which
  // POIs to show in the map.
  const [hiddenPoiIds, setHiddenPoiIds] = useState<Set<string>>(new Set());
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<string>>(new Set());
  // placingPoi is true when actively selecting a position on the Map. When a position
  // is selected, pendingLatLng will be set to the lat/lng.
  const [placingPoi, setPlacingPoi] = useState(false);
  const [pendingLatLng, setPendingLatLng] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  // Focused POI
  const [focusedLatLng, setFocusedLatLng] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  // Edit dialog states
  const [editPoiDialogOpen, setEditPoiDialogOpen] = useState(false);
  const [editingPoi, setEditingPoi] = useState<Poi | undefined>();
  const [editGroupDialogOpen, setEditGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PoiGroup | null>(null);

  const { data: pois = [] } = usePois();
  const { data: poiGroups = [] } = usePoiGroups();
  const deletePoi = useDeletePoi();
  const deletePoiGroup = useDeletePoiGroup();

  // POIs are only be visible on the map if they are not individually hidden,
  // nor in a hidden group.
  const visiblePois = useMemo(
    () =>
      pois.filter((p) => {
        if (hiddenPoiIds.has(p.id)) {
          return false;
        }
        if (p.groupId !== null && hiddenGroupIds.has(p.groupId)) {
          return false;
        }
        return true;
      }),
    [pois, hiddenPoiIds, hiddenGroupIds],
  );

  return (
    <>
      <div className="relative w-full h-full">
        <MapComponent
          tracks={tracks}
          playbackDurationS={playbackDurationS}
          selectedElapsedS={selectedElapsedS}
          onSelectedElapsedChange={onSelectedElapsedChange}
          pois={visiblePois}
          placingPoi={placingPoi}
          flyTo={focusedLatLng}
          onPoiPlaced={(lat, lng) => {
            posthog.capture("poi:placement_completed");
            setPendingLatLng({ lat, lng });
            setPlacingPoi(false);
            setEditingPoi(undefined);
            setEditPoiDialogOpen(true);
          }}
        />
        <PoiPanel
          pois={pois}
          groups={poiGroups}
          hiddenPoiIds={hiddenPoiIds}
          hiddenGroupIds={hiddenGroupIds}
          onTogglePoiVisibility={(id) => {
            posthog.capture("poi:visibility_changed", {
              visible: hiddenPoiIds.has(id),
            });
            setHiddenPoiIds((s) => toggleSet(s, id));
          }}
          onToggleGroupVisibility={(id) => {
            posthog.capture("poi:group_visibility_changed", {
              visible: hiddenGroupIds.has(id),
            });
            setHiddenGroupIds((s) => toggleSet(s, id));
          }}
          onStartPlacePoi={() => {
            posthog.capture("poi:placement_started");
            setPlacingPoi(true);
          }}
          onFocusPoi={(poi) => {
            posthog.capture("poi:focused");
            setFocusedLatLng({ lat: poi.lat, lng: poi.lng });
          }}
          onEditPoi={(poi) => {
            posthog.capture("poi:edit_started");
            setEditingPoi(poi);
            setPendingLatLng(null);
            setEditPoiDialogOpen(true);
          }}
          onEditGroup={(group) => {
            posthog.capture("poi:group_edit_started");
            setEditingGroup(group);
            setEditGroupDialogOpen(true);
          }}
          onDeletePoi={(id) => {
            posthog.capture("poi:deleted");
            deletePoi.mutate(id);
          }}
          onDeleteGroup={(id) => {
            posthog.capture("poi:group_deleted");
            deletePoiGroup.mutate(id);
          }}
        />
      </div>
      <EditPoiDialog
        open={editPoiDialogOpen}
        onOpenChange={(open, saved) => {
          if (!open && !saved) {
            posthog.capture(
              editingPoi !== undefined
                ? "poi:edit_abandoned"
                : "poi:create_abandoned",
            );
          }
          setEditPoiDialogOpen(open);
        }}
        poi={editingPoi}
        initialLat={pendingLatLng?.lat}
        initialLng={pendingLatLng?.lng}
        groups={poiGroups}
      />
      <EditGroupDialog
        open={editGroupDialogOpen}
        onOpenChange={(open, saved) => {
          if (!open && !saved) {
            posthog.capture("poi:group_edit_abandoned");
          }
          setEditGroupDialogOpen(open);
        }}
        group={editingGroup}
      />
    </>
  );
}
