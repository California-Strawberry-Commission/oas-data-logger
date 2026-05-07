import DeviceSelector from "@/components/data-selector/device-selector";
import DaySelector from "@/components/data-selector/day/day-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Device } from "@/lib/api";
import { colorForRunIndex } from "@/lib/utils";

export default function DaySelectionCard({
  title,
  index,
  device,
  dayKey,
  onDeviceChange,
  onDayKeyChange,
  onRemove,
}: {
  title?: string;
  index: number;
  device: Device | null;
  dayKey: string;
  onDeviceChange?: (device: Device | null) => void;
  onDayKeyChange?: (dayKey: string) => void;
  onRemove?: () => void;
}) {
  const color = colorForRunIndex(index);

  return (
    <Card>
      {(title || onRemove) && (
        <CardHeader className="flex items-center justify-between">
          <CardTitle>
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="text-sm font-medium pl-2">{title}</span>
          </CardTitle>
          {onRemove && (
            <Button variant="secondary" size="sm" onClick={onRemove}>
              Remove
            </Button>
          )}
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">Device</div>
          <DeviceSelector
            value={device?.id ?? ""}
            onValueChange={(nextDevice) => {
              onDeviceChange?.(nextDevice);
              onDayKeyChange?.("");
            }}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Day</div>
          {device ? (
            <DaySelector
              deviceId={device.id}
              value={dayKey}
              onValueChange={onDayKeyChange}
            />
          ) : (
            <div className="rounded-md border border-dashed py-2 px-3 text-sm text-muted-foreground">
              Select a device to load days.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
