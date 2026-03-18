"use client";

import Combobox from "@/components/ui/combobox";
import { useDevices, type Device } from "@/lib/api";
import posthog from "posthog-js";
import { useEffect, useMemo } from "react";

function getDeviceLabel(device: Device): string {
  return device.name ? `${device.name} (${device.id})` : device.id;
}

export default function DeviceSelector({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (device: Device | null) => void;
}) {
  const { data: devices = [], isLoading, error } = useDevices();

  const sortedDevices = useMemo(() => {
    const copy = [...devices];
    copy.sort((a: Device, b: Device) => {
      const aName = a.name ?? null;
      const bName = b.name ?? null;

      // Non-null names first
      if (aName === null && bName !== null) {
        return 1;
      }
      if (aName !== null && bName === null) {
        return -1;
      }

      // If both names exist, then compare name
      if (aName !== null && bName !== null) {
        const nameCmp = aName.localeCompare(bName, undefined, {
          sensitivity: "base",
        });
        if (nameCmp !== 0) {
          return nameCmp;
        }
      }

      // If both names are null, then compare id
      return a.id.localeCompare(b.id);
    });
    return copy;
  }, [devices]);

  // If the selected device no longer exists, clear it
  useEffect(() => {
    if (!isLoading && value && !sortedDevices.some((d) => d.id === value)) {
      onValueChange(null);
    }
  }, [value, sortedDevices, isLoading, onValueChange]);

  const items = useMemo(() => {
    if (isLoading) {
      return [{ value: "__loading__", label: "Loading devices..." }];
    }
    if (error) {
      return [{ value: "__error__", label: "Failed to load devices" }];
    }
    return sortedDevices.map((device) => ({
      value: device.id,
      label: getDeviceLabel(device),
    }));
  }, [sortedDevices, isLoading, error]);

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

        const device = sortedDevices.find((d) => d.id === next) ?? null;
        posthog.capture("device_selected", {
          device_id: device?.id,
          device_name: device?.name,
        });
        onValueChange(device);
      }}
      placeholder={isLoading ? "Loading devices..." : "Select device..."}
      searchPlaceholder={isLoading ? "Loading..." : "Search device..."}
      disabled={hasPlaceholder}
    />
  );
}
