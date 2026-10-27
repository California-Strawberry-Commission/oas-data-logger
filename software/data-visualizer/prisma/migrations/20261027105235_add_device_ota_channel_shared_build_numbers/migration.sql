/*
  Warnings:

  - A unique constraint covering the columns `[deviceType,buildNumber]` on the table `FirmwareRelease` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "FirmwareRelease_deviceType_channel_buildNumber_key";

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "otaChannel" "OtaChannel" NOT NULL DEFAULT 'STABLE';

-- CreateIndex
CREATE UNIQUE INDEX "FirmwareRelease_deviceType_buildNumber_key" ON "FirmwareRelease"("deviceType", "buildNumber");
