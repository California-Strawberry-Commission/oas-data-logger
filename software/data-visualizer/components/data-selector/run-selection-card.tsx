import DeviceSelector from "@/components/data-selector/device-selector";
import RunSelector from "@/components/data-selector/run-selector";
import { Button } from "@/components/ui/button";
import { type Device, type Run } from "@/lib/api";
import { colorForRunIndex } from "@/lib/utils";

export default function RunSelectionCard({
  title,
  index,
  row,
  onChange,
  onRemove,
}: {
  title?: string;
  index: number;
  row: { rowId: string; device: Device | null; run: Run | null };
  onChange: (
    patch: Partial<{ device: Device | null; run: Run | null }>,
  ) => void;
  onRemove?: () => void;
}) {
  const { device, run } = row;
  const color = colorForRunIndex(index);

  return (
    <div className="rounded-lg border p-4 space-y-4">
      {(title || onRemove) && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-3 w-3 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="text-sm font-medium">{title}</span>
          </div>
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
          value={device?.id ?? ""}
          onValueChange={(nextDevice) => {
            // Clear run if device changes
            onChange({ device: nextDevice, run: null });
          }}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Run</div>
        {device ? (
          <RunSelector
            deviceId={device.id}
            value={run?.uuid ?? ""}
            onValueChange={(nextRun) => onChange({ run: nextRun })}
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
