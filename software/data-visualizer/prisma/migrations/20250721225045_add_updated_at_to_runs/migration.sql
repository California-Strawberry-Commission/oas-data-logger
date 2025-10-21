/*
  Warnings:

  - Added the required column `updatedAt` to the `Run` table with a default value of CURRENT_TIMESTAMP.

*/
-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "epochTimeS" SET DATA TYPE BIGINT,
ALTER COLUMN "tickBaseUs" SET DATA TYPE BIGINT;
