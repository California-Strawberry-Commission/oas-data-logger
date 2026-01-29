import type { User } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { Prisma, Run } from "@/generated/prisma/client";

export function runWhereForUser(
  user: User,
  uuid: string,
): Prisma.RunWhereInput {
  // ADMINs can access all runs.
  // Others can only access runs for devices they are associated with.
  const where =
    user.role === "ADMIN"
      ? { uuid }
      : {
          uuid,
          device: {
            userDevices: {
              some: {
                userId: user.id,
              },
            },
          },
        };
  return where;
}

export function runsWhereForUser(user: User): Prisma.RunWhereInput {
  // ADMINs can access all runs.
  // Others can only access runs for devices they are associated with.
  const where =
    user.role === "ADMIN"
      ? {}
      : {
          device: {
            userDevices: {
              some: {
                userId: user.id,
              },
            },
          },
        };
  return where;
}

export function devicesWhereForUser(user: User): Prisma.DeviceWhereInput {
  // ADMINs can access all devices.
  // USERs can only access devices they are associated with.
  const where =
    user.role === "ADMIN"
      ? {}
      : {
          userDevices: {
            some: {
              userId: user.id,
            },
          },
        };
  return where;
}

/**
 * Get run by UUID.
 *
 * @param user
 * @param uuid
 * @param options
 * @returns Returns the Run if it exists and the user is allowed to access it, otherwise null.
 */
export async function getRunForUser(
  user: User,
  uuid: string,
  options?: {
    select?: Prisma.RunSelect;
    include?: Prisma.RunInclude;
  },
): Promise<Run | null> {
  const where = runWhereForUser(user, uuid);
  return prisma.run.findFirst({
    where,
    ...options,
  });
}
