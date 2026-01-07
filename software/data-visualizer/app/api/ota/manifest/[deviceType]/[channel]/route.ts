import { DeviceType, OtaChannel } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deviceType: string; channel: string }> }
) {
  const p = await params;
  const deviceType = p.deviceType.toUpperCase();
  const channel = p.channel.toUpperCase();

  // Validate params
  if (!(deviceType in DeviceType)) {
    return NextResponse.json(
      {
        error: "Invalid deviceType",
      },
      { status: 400 }
    );
  }
  if (!(channel in OtaChannel)) {
    return NextResponse.json(
      {
        error: "Invalid channel",
      },
      { status: 400 }
    );
  }

  // Get the latest published firmware
  const latest = await prisma.firmwareRelease.findFirst({
    where: {
      deviceType: deviceType as any,
      channel: channel as any,
      isPublished: true,
    },
    orderBy: { buildNumber: "desc" },
    select: {
      deviceType: true,
      channel: true,
      buildNumber: true,
      version: true,
      sha256: true,
      size: true,
      createdAt: true,
      publishedAt: true,
    },
  });

  return NextResponse.json(
    {
      deviceType,
      channel,
      latest: latest ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
