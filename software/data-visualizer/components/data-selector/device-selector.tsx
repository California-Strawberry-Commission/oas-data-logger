"use client";

import Combobox from "@/components/ui/combobox";
import { useEffect, useMemo, useState } from "react";

type Device = {
  id: string;
  name: string | null;
};

function getDeviceLabel(device: Device): string {
  return device.name ? `${device.name} (${device.id})` : device.id;
}

export default function DeviceSelector({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (deviceId: string) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/devices")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) {
          return;
        }

        const devices: Device[] = data.map((d: any) => ({
          id: d.id,
          name: d.name,
        }));
        const sorted = devices.sort((a: Device, b: Device) => {
          // Non-null names first
          if (a.name === null && b.name !== null) {
            return 1;
          }
          if (a.name !== null && b.name === null) {
            return -1;
          }

          // If both names exist, then compare name
          if (a.name !== null && b.name !== null) {
            const nameCmp = a.name.localeCompare(b.name, undefined, {
              sensitivity: "base",
            });
            if (nameCmp !== 0) {
              return nameCmp;
            }
          }

          // If both names are null, then compare id
          return a.id.localeCompare(b.id);
        });
        setDevices(sorted);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // If the selected device no longer exists, clear it
  useEffect(() => {
    if (value && !devices.some((d) => d.id === value)) {
      onValueChange("");
    }
  }, [value, devices, onValueChange]);

  const items = useMemo(
    () =>
      devices.map((device) => ({
        value: device.id,
        label: getDeviceLabel(device),
      })),
    [devices],
  );

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={"Select device..."}
      searchPlaceholder={"Search device..."}
    />
  );
}
