import DeviceSelector from "@/components/data-selector/device-selector";
import SessionSelector from "@/components/data-selector/session/session-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Device } from "@/lib/api";
import { colorForSelectionIndex } from "@/lib/utils";

export default function SessionSelectionCard({
  title,
  index,
  device,
  sessionKey,
  onDeviceChange,
  onSessionKeyChange,
  onRemove,
}: {
  title?: string;
  index: number;
  device: Device | null;
  sessionKey: string;
  onDeviceChange?: (device: Device | null) => void;
  onSessionKeyChange?: (sessionKey: string) => void;
  onRemove?: () => void;
}) {
  const color = colorForSelectionIndex(index);

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
              onSessionKeyChange?.("");
            }}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Session</div>
          {device ? (
            <SessionSelector
              deviceId={device.id}
              value={sessionKey}
              onValueChange={onSessionKeyChange}
            />
          ) : (
            <div className="rounded-md border border-dashed py-2 px-3 text-sm text-muted-foreground">
              Select a device to load sessions.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
