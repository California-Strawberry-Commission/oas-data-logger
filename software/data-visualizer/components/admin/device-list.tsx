"use client";

import {
  updateDeviceAction,
  type UpdateDeviceFormState,
} from "@/app/admin/actions";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

type Device = {
  id: string;
  name: string | null;
  isProvisioned: boolean;
};

function UpdateDeviceSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving..." : "Save changes"}
    </Button>
  );
}

function UpdateDeviceForm({
  device,
  onClose,
}: {
  device: Device;
  onClose: () => void;
}) {
  const initialState: UpdateDeviceFormState = { success: false };
  const [formState, formAction] = useActionState(
    updateDeviceAction,
    initialState,
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Close the modal when we get a successful result after submitting
  useEffect(() => {
    if (hasSubmitted && formState.success && !formState.error) {
      onClose();
    }
  }, [hasSubmitted, formState.success, formState.error, onClose]);

  return (
    <form
      action={formAction}
      className="space-y-4 mt-2"
      key={device.id} // reset form and errors when a different device is opened
      onSubmit={() => setHasSubmitted(true)}
    >
      <input type="hidden" name="deviceId" value={device.id} />

      <div className="space-y-1">
        <Label>Device UID</Label>
        <p className="text-sm border rounded-md px-2 py-1 bg-muted text-muted-foreground">
          {device.id}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name (optional)</Label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={device.name ?? ""}
          className="w-full border rounded-md px-2 py-1 text-sm"
        />
      </div>

      {formState.error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{formState.error}</AlertTitle>
        </Alert>
      )}

      <UpdateDeviceSubmitButton />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onClose}
      >
        Cancel
      </Button>
    </form>
  );
}

export default function DeviceList({ devices }: { devices: Device[] }) {
  const [open, setOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  function handleCardClick(device: Device) {
    setSelectedDevice(device);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    setSelectedDevice(null);
  }

  if (devices.length === 0) {
    return (
      <section className="border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">Devices</h2>
        <p className="text-sm text-muted-foreground">No devices yet.</p>
      </section>
    );
  }

  return (
    <>
      <section className="border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">Devices</h2>

        <div className="space-y-3">
          {devices.map((device) => (
            <button
              key={device.id}
              type="button"
              onClick={() => handleCardClick(device)}
              className="w-full text-left border rounded-md p-3 flex flex-col gap-1 hover:bg-muted transition"
            >
              <div className="flex justify-between items-center">
                <span className="font-medium">{device.id}</span>
                {!device.isProvisioned && (
                  <span className="text-xs text-destructive">
                    {"unprovisioned"}
                  </span>
                )}
              </div>
              {device.name && (
                <div className="text-sm text-muted-foreground">
                  {device.name}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        {selectedDevice && (
          <DialogContent className="sm:max-w-120">
            <DialogHeader>
              <DialogTitle>Edit device</DialogTitle>
              <DialogDescription></DialogDescription>
            </DialogHeader>

            <UpdateDeviceForm device={selectedDevice} onClose={handleClose} />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
