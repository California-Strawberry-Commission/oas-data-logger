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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError("");

        const res = await fetch("/api/devices");
        if (!res.ok) {
          throw new Error(`Failed to fetch devices (${res.status})`);
        }

        const data = await res.json();
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
      } catch (e) {
        if (cancelled) {
          return;
        }
        setDevices([]);
        setError("Failed to load devices");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // If the selected device no longer exists, clear it
  useEffect(() => {
    if (!isLoading && value && !devices.some((d) => d.id === value)) {
      onValueChange("");
    }
  }, [value, devices, isLoading, onValueChange]);

  const items = useMemo(() => {
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading devices..." }];
    }
    if (error) {
      return [{ value: "__error__", label: error }];
    }
    return devices.map((device) => ({
      value: device.id,
      label: getDeviceLabel(device),
    }));
  }, [devices, isLoading, error]);

  const hasPlaceholder = items.length > 0 && items[0].value.startsWith("__");

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next) => {
        // Ignore placeholder items
        if (next.startsWith("__")) {
          return;
        }
        onValueChange(next);
      }}
      placeholder={isLoading ? "Loading devices..." : "Select device..."}
      searchPlaceholder={isLoading ? "Loading..." : "Search device..."}
      disabled={hasPlaceholder}
    />
  );
}
