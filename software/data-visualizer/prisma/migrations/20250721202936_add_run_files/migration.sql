-- CreateTable
CREATE TABLE "RunFile" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunFile_runId_idx" ON "RunFile"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "RunFile_runId_fileName_key" ON "RunFile"("runId", "fileName");

-- AddForeignKey
ALTER TABLE "RunFile" ADD CONSTRAINT "RunFile_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
