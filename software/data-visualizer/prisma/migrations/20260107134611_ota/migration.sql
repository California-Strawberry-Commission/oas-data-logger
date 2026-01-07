-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('V0', 'V1');

-- CreateEnum
CREATE TYPE "OtaChannel" AS ENUM ('STABLE', 'BETA');

-- CreateTable
CREATE TABLE "FirmwareRelease" (
    "id" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "channel" "OtaChannel" NOT NULL DEFAULT 'STABLE',
    "version" TEXT NOT NULL,
    "buildNumber" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "FirmwareRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FirmwareRelease_deviceType_channel_isPublished_buildNumber_idx" ON "FirmwareRelease"("deviceType", "channel", "isPublished", "buildNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FirmwareRelease_deviceType_channel_buildNumber_key" ON "FirmwareRelease"("deviceType", "channel", "buildNumber");
