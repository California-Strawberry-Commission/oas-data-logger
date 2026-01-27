-- DropForeignKey
ALTER TABLE "RunData" DROP CONSTRAINT "RunData_runId_fkey";

-- AddForeignKey
ALTER TABLE "RunData" ADD CONSTRAINT "RunData_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
