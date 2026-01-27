import CreateDeviceForm from "@/components/admin/create-device-form";
import CreateUserForm from "@/components/admin/create-user-form";
import DeviceList from "@/components/admin/device-list";
import UserList from "@/components/admin/user-list";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { getCurrentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AlertCircleIcon } from "lucide-react";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    // Not logged in - redirect to home to login
    redirect("/");
  }

  if (currentUser.role !== "ADMIN") {
    return (
      <main className="flex flex-col items-center p-4 gap-4">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Access denied: admin only.</AlertTitle>
        </Alert>
      </main>
    );
  }

  const [devicesRaw, users] = await Promise.all([
    prisma.device.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        secret: { select: { deviceId: true } }, // only need existence
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        userDevices: {
          include: { device: true },
        },
      },
    }),
  ]);

  const devices = devicesRaw.map((d) => ({
    id: d.id,
    name: d.name,
    isProvisioned: !!d.secret,
  }));

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Admin Panel</h1>
      <p className="text-sm text-muted-foreground">
        Logged in as{" "}
        <span className="font-mono font-bold">{currentUser.email}</span>
      </p>

      <CreateDeviceForm />
      <CreateUserForm devices={devices} />
      <UserList users={users} devices={devices} />
      <DeviceList devices={devices} />
    </main>
  );
}
