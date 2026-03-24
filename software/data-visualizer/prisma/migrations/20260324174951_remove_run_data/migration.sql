/*
  Warnings:

  - You are about to drop the `RunData` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "RunData" DROP CONSTRAINT "RunData_runId_fkey";

-- DropTable
DROP TABLE "RunData";
