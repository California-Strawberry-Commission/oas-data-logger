"use client";

import {
  createDeviceAction,
  type CreateDeviceFormState,
} from "@/app/admin/actions";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    initialState,
  );

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg">Create new device</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deviceId">Device UID</Label>
            <Input
              id="deviceId"
              name="deviceId"
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
      </CardContent>
    </Card>
  );
}
