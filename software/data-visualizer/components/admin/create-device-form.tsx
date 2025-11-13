"use client";

import {
  createDeviceAction,
  type CreateDeviceFormState,
} from "@/app/admin/actions";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating..." : "Create device"}
    </Button>
  );
}

export default function CreateDeviceForm() {
  const initialState: CreateDeviceFormState = {};
  const [formState, formAction] = useActionState(
    createDeviceAction,
    initialState
  );

  return (
    <section className="border rounded-lg p-4 space-y-4">
      <h2 className="text-lg font-semibold">Create new device</h2>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="deviceUid">Device UID</Label>
          <Input
            id="deviceUid"
            name="deviceUid"
            type="text"
            placeholder="unique-device-uid-123"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Name (optional)</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="My test device"
          />
        </div>

        {formState.error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{formState.error}</AlertTitle>
          </Alert>
        )}

        <SubmitButton />
      </form>
    </section>
  );
}
