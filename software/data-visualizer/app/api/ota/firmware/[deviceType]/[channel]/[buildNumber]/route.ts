import { DeviceType, OtaChannel } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { s3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      deviceType: string;
      channel: string;
      buildNumber: string;
    }>;
  }
) {
  const p = await params;
  const deviceType = p.deviceType.toUpperCase();
  const channel = p.channel.toUpperCase();
  const buildNumber = Number(p.buildNumber);

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
  if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
    return NextResponse.json(
      {
        error: "buildNumber must be a positive integer",
      },
      { status: 400 }
    );
  }

  const release = await prisma.firmwareRelease.findUnique({
    where: {
      deviceType_channel_buildNumber: {
        deviceType: deviceType as any,
        channel: channel as any,
        buildNumber,
      },
    },
    select: {
      isPublished: true,
      s3Key: true,
      size: true,
      sha256: true,
      version: true,
      buildNumber: true,
      deviceType: true,
      channel: true,
    },
  });

  if (!release || !release.isPublished) {
    return NextResponse.json({ error: "Firmware not found" }, { status: 404 });
  }

  // Return a redirect to a presigned URL to the S3 object so that the client can fetch the
  // firmware directly from S3 instead of streaming through the server
  const cmd = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: release.s3Key,
  });
  const url = await getSignedUrl(s3Client, cmd, {
    expiresIn: 60 /* seconds */,
  });

  return NextResponse.redirect(url, { status: 302 });
}
