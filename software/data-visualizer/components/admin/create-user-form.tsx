"use client";

import {
  createUserAction,
  type CreateUserFormState,
} from "@/app/admin/actions";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

type Device = {
  id: string;
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
    initialState,
  );

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg">Create new user</CardTitle>
      </CardHeader>
      <CardContent>
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
              {devices.map((device) => {
                const checkboxId = `create-user-device-${device.id}`;
                return (
                  <div key={device.id} className="flex items-center gap-2">
                    <Checkbox
                      id={checkboxId}
                      name="deviceIds"
                      value={device.id}
                    />
                    <Label
                      htmlFor={checkboxId}
                      className="font-normal cursor-pointer"
                    >
                      {device.id}
                      {device.name && (
                        <span className="text-xs text-muted-foreground">
                          ({device.name})
                        </span>
                      )}
                    </Label>
                  </div>
                );
              })}
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
      </CardContent>
    </Card>
  );
}
