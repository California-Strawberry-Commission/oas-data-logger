"use server";

import { getCurrentUser, hashPassword } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export type CreateDeviceFormState = {
  error?: string;
};

export type CreateUserFormState = {
  error?: string;
};

export type UpdateUserFormState = {
  success: boolean;
  error?: string;
};

export type UpdateDeviceFormState = {
  success: boolean;
  error?: string;
};

export async function createDeviceAction(
  _prevState: CreateDeviceFormState,
  formData: FormData
): Promise<CreateDeviceFormState> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "ADMIN") {
      return { error: "Not authorized" };
    }

    const deviceUid = (formData.get("deviceUid") as string | null)?.trim();
    const name = (formData.get("name") as string | null)?.trim();

    if (!deviceUid) {
      return { error: "Device UID is required" };
    }

    await prisma.device.create({
      data: {
        deviceUid,
        name: name || null,
      },
    });

    // Refresh the admin page so new device shows up
    revalidatePath("/admin");

    return {};
  } catch (err: any) {
    console.error("createDeviceAction error:", err);
    return {
      error:
        err?.code === "P2002" // Prisma unique constraint error
          ? "A device with that UID already exists."
          : err?.message || "Failed to create device.",
    };
  }
}

export async function createUserAction(
  _prevState: CreateUserFormState,
  formData: FormData
): Promise<CreateUserFormState> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "ADMIN") {
      return { error: "Not authorized" };
    }

    const email = (formData.get("email") as string | null)?.trim();
    const password = formData.get("password") as string | null;
    const deviceIdsRaw = formData.getAll("deviceIds") as string[];

    if (!email || !password) {
      return { error: "Email and password are required" };
    }

    const deviceIds = deviceIdsRaw
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n));

    const passwordHash = await hashPassword(password);

    await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: "USER",
        userDevices: deviceIds.length
          ? {
              create: deviceIds.map((deviceId) => ({
                device: { connect: { id: deviceId } },
                role: "VIEWER",
              })),
            }
          : undefined,
      },
    });

    // Refresh the admin page so new user shows up
    revalidatePath("/admin");

    return {};
  } catch (err: any) {
    console.error("createUserAction error:", err);
    return {
      error:
        err?.code === "P2002" // Prisma unique constraint error
          ? "A user with that email already exists."
          : err?.message || "Failed to create user.",
    };
  }
}

export async function updateUserAction(
  _prevState: UpdateUserFormState,
  formData: FormData
): Promise<UpdateUserFormState> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const userId = Number(formData.get("userId"));
    const role = formData.get("role") as string | null;
    const deviceIdsRaw = formData.getAll("deviceIds") as string[];

    if (!userId || !role) {
      return { success: false, error: "User id and role are required" };
    }

    const deviceIds = deviceIdsRaw
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n));

    // Update user & their device associations
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          role: role as any,
        },
      });

      // Reset userDevices and recreate from submitted list
      await tx.userDevice.deleteMany({ where: { userId } });

      if (deviceIds.length) {
        await tx.userDevice.createMany({
          data: deviceIds.map((deviceId) => ({
            userId,
            deviceId,
            role: "VIEWER",
          })),
        });
      }
    });

    // Refresh the admin page so updated user shows up
    revalidatePath("/admin");

    return { success: true };
  } catch (err: any) {
    console.error("updateUserAction error:", err);
    return {
      success: false,
      error: err?.message || "Failed to update user.",
    };
  }
}

export async function updateDeviceAction(
  _prevState: UpdateDeviceFormState,
  formData: FormData
): Promise<UpdateDeviceFormState> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const deviceId = Number(formData.get("deviceId"));
    const name = (formData.get("name") as string | null)?.trim();

    if (!deviceId) {
      return { success: false, error: "Device id is required" };
    }

    await prisma.device.update({
      where: { id: deviceId },
      data: {
        name: name || null,
      },
    });

    // Refresh the admin page so updated device shows up
    revalidatePath("/admin");

    return { success: true };
  } catch (err: any) {
    console.error("updateDeviceAction error:", err);
    return {
      success: false,
      error: err?.message || "Failed to update device.",
    };
  }
}
