"use client";

import {
  updateUserAction,
  type UpdateUserFormState,
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
  id: number;
  deviceUid: string;
  name: string | null;
};

type UserDevice = {
  deviceId: number;
  device: Device;
};

type User = {
  id: number;
  email: string;
  role: "USER" | "ADMIN";
  userDevices: UserDevice[];
};

function UpdateUserSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving..." : "Save changes"}
    </Button>
  );
}

function UpdateUserForm({
  user,
  devices,
  onClose,
}: {
  user: User;
  devices: Device[];
  onClose: () => void;
}) {
  const initialState: UpdateUserFormState = { success: false };
  const [formState, formAction] = useActionState(
    updateUserAction,
    initialState
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
      key={user.id} // reset form and errors when a different user is opened
      onSubmit={() => setHasSubmitted(true)}
    >
      <input type="hidden" name="userId" value={user.id} />

      <div className="space-y-1">
        <Label>Email</Label>
        <p className="text-sm border rounded-md px-2 py-1 bg-muted text-muted-foreground">
          {user.email}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          defaultValue={user.role}
          className="w-full border rounded-md px-2 py-1 text-sm"
          required
        >
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">New password (optional)</Label>
        <input
          id="password"
          name="password"
          type="password"
          className="w-full border rounded-md px-2 py-1 text-sm"
          placeholder="Leave blank to keep current password"
          autoComplete="new-password"
        />
      </div>

      <div className="space-y-2">
        <Label>Devices</Label>
        <div className="flex flex-col gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
          {devices.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No devices found. Create devices first.
            </p>
          )}
          {devices.map((device) => {
            const checked = user.userDevices.some(
              (ud) => ud.deviceId === device.id
            );
            return (
              <label
                key={device.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  name="deviceIds"
                  value={device.id}
                  defaultChecked={checked}
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

      <UpdateUserSubmitButton />
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

export default function UserList({
  users,
  devices,
}: {
  users: User[];
  devices: Device[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  function handleCardClick(user: User) {
    setSelectedUser(user);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    setSelectedUser(null);
  }

  if (users.length === 0) {
    return (
      <section className="border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <p className="text-sm text-muted-foreground">No users yet.</p>
      </section>
    );
  }

  return (
    <>
      <section className="border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">Users</h2>

        <div className="space-y-3">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => handleCardClick(user)}
              className="w-full text-left border rounded-md p-3 flex flex-col gap-1 hover:bg-muted transition"
            >
              <div className="flex justify-between items-center">
                <span className="font-medium">{user.email}</span>
                <span className="text-xs uppercase text-muted-foreground">
                  {user.role}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Devices:{" "}
                {user.userDevices.length === 0 ? (
                  <span className="text-muted-foreground">none</span>
                ) : (
                  user.userDevices.map((ud) => ud.device.deviceUid).join(", ")
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        {selectedUser && (
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Edit user</DialogTitle>
              <DialogDescription></DialogDescription>
            </DialogHeader>

            <UpdateUserForm
              user={selectedUser}
              devices={devices}
              onClose={handleClose}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
