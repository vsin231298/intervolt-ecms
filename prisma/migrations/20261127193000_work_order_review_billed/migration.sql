-- AlterEnum
ALTER TYPE "CloseReason" ADD VALUE 'MERGED';
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "billedAt" TIMESTAMP(3),
ADD COLUMN     "billedById" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "pendingReview" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "WorkOrderSignoff" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- Work orders already in the system count as reviewed.
UPDATE "WorkOrderSignoff" SET "reviewedAt" = "createdAt" WHERE "reviewedAt" IS NULL;
