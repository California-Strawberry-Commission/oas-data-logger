-- CreateTable
CREATE TABLE "DeviceSecret" (
    "deviceId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceSecret_pkey" PRIMARY KEY ("deviceId")
);

-- AddForeignKey
ALTER TABLE "DeviceSecret" ADD CONSTRAINT "DeviceSecret_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
