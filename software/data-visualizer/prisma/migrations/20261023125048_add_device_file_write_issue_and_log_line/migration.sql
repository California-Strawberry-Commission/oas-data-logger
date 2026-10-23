-- CreateTable
CREATE TABLE "DeviceFileWriteIssue" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "heartbeatId" INTEGER NOT NULL,
    "bootCount" INTEGER NOT NULL,
    "uptimeMs" BIGINT NOT NULL,
    "lastUptimeMs" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "type" INTEGER NOT NULL,
    "streamType" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL,
    "maxDurationMs" INTEGER NOT NULL,

    CONSTRAINT "DeviceFileWriteIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLogLine" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "heartbeatId" INTEGER NOT NULL,
    "bootCount" INTEGER NOT NULL,
    "uptimeMs" BIGINT NOT NULL,
    "lastUptimeMs" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "msg" TEXT NOT NULL,

    CONSTRAINT "DeviceLogLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceFileWriteIssue_deviceId_idx" ON "DeviceFileWriteIssue"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceLogLine_deviceId_idx" ON "DeviceLogLine"("deviceId");

-- AddForeignKey
ALTER TABLE "DeviceFileWriteIssue" ADD CONSTRAINT "DeviceFileWriteIssue_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceFileWriteIssue" ADD CONSTRAINT "DeviceFileWriteIssue_heartbeatId_fkey" FOREIGN KEY ("heartbeatId") REFERENCES "DeviceHeartbeat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLogLine" ADD CONSTRAINT "DeviceLogLine_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLogLine" ADD CONSTRAINT "DeviceLogLine_heartbeatId_fkey" FOREIGN KEY ("heartbeatId") REFERENCES "DeviceHeartbeat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
