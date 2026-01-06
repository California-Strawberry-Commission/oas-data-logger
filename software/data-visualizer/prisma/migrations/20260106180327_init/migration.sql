-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "DeviceRole" AS ENUM ('VIEWER');

-- CreateEnum
CREATE TYPE "StreamType" AS ENUM ('POLLED', 'EVENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AppRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "role" "DeviceRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("userId","deviceId")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "epochTimeS" BIGINT NOT NULL,
    "tickBaseUs" BIGINT NOT NULL,
    "metadata" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunData" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "streamType" "StreamType" NOT NULL,
    "streamId" TEXT NOT NULL,
    "tick" BIGINT NOT NULL,
    "data" TEXT NOT NULL,

    CONSTRAINT "RunData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserDevice_deviceId_role_idx" ON "UserDevice"("deviceId", "role");

-- CreateIndex
CREATE INDEX "UserDevice_userId_role_idx" ON "UserDevice"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Run_uuid_key" ON "Run"("uuid");

-- CreateIndex
CREATE INDEX "RunData_runId_streamType_streamId_tick_idx" ON "RunData"("runId", "streamType", "streamId", "tick");

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunData" ADD CONSTRAINT "RunData_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
