import DeviceSelector from "@/components/data-selector/device-selector";
import RunSelector from "@/components/data-selector/run-selector";
import { Button } from "@/components/ui/button";

export default function RunSelectionCard({
  title,
  row,
  runsRefreshKey,
  onChange,
  onRemove,
}: {
  title?: string;
  row: { rowId: string; deviceId: string; runUuid: string };
  runsRefreshKey: number;
  onChange: (patch: Partial<{ deviceId: string; runUuid: string }>) => void;
  onRemove?: () => void;
}) {
  const { deviceId, runUuid } = row;

  return (
    <div className="rounded-lg border p-4 space-y-4">
      {title && onRemove && (
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">{title}</div>
          {onRemove && (
            <Button variant="secondary" size="sm" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium">Device</div>
        <DeviceSelector
          value={deviceId}
          onValueChange={(nextDevice) => {
            // Clear run if device changes
            onChange({ deviceId: nextDevice, runUuid: "" });
          }}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Run</div>
        {deviceId ? (
          <RunSelector
            key={`${deviceId}:${runsRefreshKey}`} // forces refetch after delete
            deviceId={deviceId}
            value={runUuid}
            onValueChange={(nextRun) => onChange({ runUuid: nextRun })}
          />
        ) : (
          <div className="rounded-md border border-dashed py-2 px-3 text-sm text-muted-foreground">
            Select a device to load runs.
          </div>
        )}
      </div>
    </div>
  );
}
