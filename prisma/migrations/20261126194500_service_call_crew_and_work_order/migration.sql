-- Helpers join service calls; richer field work order form
ALTER TABLE "Worker" ADD COLUMN "helperOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkOrderSignoff" ADD COLUMN "jobStatus" TEXT,
ADD COLUMN "coWorkerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "materialsUsed" JSONB,
ADD COLUMN "parkingAmount" DECIMAL(10,2),
ADD COLUMN "parkingReceiptDocId" TEXT;
