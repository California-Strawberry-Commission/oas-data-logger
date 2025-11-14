"use client";

import {
  createUserAction,
  type CreateUserFormState,
} from "@/app/admin/actions";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

type Device = {
  id: number;
  deviceUid: string;
  name: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating..." : "Create user"}
    </Button>
  );
}

export default function CreateUserForm({ devices }: { devices: Device[] }) {
  const initialState: CreateUserFormState = {};
  const [formState, formAction] = useActionState(
    createUserAction,
    initialState
  );

  return (
    <section className="border rounded-lg p-4 space-y-4">
      <h2 className="text-lg font-semibold">Create new user</h2>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="user@example.com"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <Label>Devices (optional)</Label>
          <div className="flex flex-col gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
            {devices.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No devices found. Create devices first.
              </p>
            )}
            {devices.map((device) => (
              <label
                key={device.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  name="deviceIds"
                  value={device.id}
                  className="h-4 w-4"
                />
                <span>
                  {device.deviceUid}{" "}
                  {device.name && (
                    <span className="text-xs text-muted-foreground">
                      ({device.name})
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
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
