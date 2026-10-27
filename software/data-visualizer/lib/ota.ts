import { OtaChannel } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * Returns the release channels a device on the given OTA channel may receive.
 * STABLE devices receive STABLE releases only, while BETA devices receive both
 * BETA and STABLE releases (whichever has the highest build number).
 */
export function receivableChannels(otaChannel: OtaChannel): OtaChannel[] {
  return otaChannel === OtaChannel.BETA
    ? [OtaChannel.BETA, OtaChannel.STABLE]
    : [OtaChannel.STABLE];
}

/**
 * Returns the OTA channel of the device.
 */
export async function getDeviceOtaChannel(
  deviceId: string,
): Promise<OtaChannel> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { otaChannel: true },
  });
  return device?.otaChannel ?? OtaChannel.STABLE;
}
