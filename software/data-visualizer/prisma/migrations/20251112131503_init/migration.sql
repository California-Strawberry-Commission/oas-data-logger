-- CreateEnum
CREATE TYPE "StreamType" AS ENUM ('POLLED', 'EVENT');

-- CreateTable
CREATE TABLE "Run" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "epochTimeS" BIGINT NOT NULL,
    "tickBaseUs" BIGINT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT false,

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
CREATE UNIQUE INDEX "Run_uuid_key" ON "Run"("uuid");

-- AddForeignKey
ALTER TABLE "RunData" ADD CONSTRAINT "RunData_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
