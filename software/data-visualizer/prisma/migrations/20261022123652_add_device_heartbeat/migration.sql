-- CreateTable
CREATE TABLE "DeviceHeartbeat" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firmwareBuild" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "otaChannel" TEXT NOT NULL,
    "bootCount" INTEGER NOT NULL,
    "uptimeMs" BIGINT NOT NULL,
    "resetReason" INTEGER NOT NULL,
    "appResetReason" INTEGER NOT NULL,
    "state" INTEGER,
    "heapFree" INTEGER NOT NULL,
    "heapMinFree" INTEGER NOT NULL,
    "heapLargestBlock" INTEGER NOT NULL,
    "rssi" INTEGER NOT NULL,

    CONSTRAINT "DeviceHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCrash" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bootCount" INTEGER NOT NULL,
    "task" TEXT NOT NULL,
    "pc" BIGINT NOT NULL,
    "cause" INTEGER NOT NULL,
    "vaddr" BIGINT NOT NULL,
    "backtrace" BIGINT[],
    "backtraceCorrupted" BOOLEAN NOT NULL,
    "elfSha256" TEXT NOT NULL,

    CONSTRAINT "DeviceCrash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceWifiDisconnectEvent" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "heartbeatId" INTEGER NOT NULL,
    "bootCount" INTEGER NOT NULL,
    "uptimeMs" BIGINT NOT NULL,
    "lastUptimeMs" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "reason" INTEGER NOT NULL,
    "rssi" INTEGER NOT NULL,
    "wasConnected" BOOLEAN NOT NULL,

    CONSTRAINT "DeviceWifiDisconnectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceHeartbeat_deviceId_receivedAt_idx" ON "DeviceHeartbeat"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "DeviceCrash_deviceId_receivedAt_idx" ON "DeviceCrash"("deviceId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCrash_deviceId_bootCount_pc_key" ON "DeviceCrash"("deviceId", "bootCount", "pc");

-- CreateIndex
CREATE INDEX "DeviceWifiDisconnectEvent_deviceId_idx" ON "DeviceWifiDisconnectEvent"("deviceId");

-- AddForeignKey
ALTER TABLE "DeviceHeartbeat" ADD CONSTRAINT "DeviceHeartbeat_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCrash" ADD CONSTRAINT "DeviceCrash_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceWifiDisconnectEvent" ADD CONSTRAINT "DeviceWifiDisconnectEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceWifiDisconnectEvent" ADD CONSTRAINT "DeviceWifiDisconnectEvent_heartbeatId_fkey" FOREIGN KEY ("heartbeatId") REFERENCES "DeviceHeartbeat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
