-- AlterTable
ALTER TABLE "WorkOrderSignoff" ADD COLUMN     "forDate" DATE;

-- CreateTable
CREATE TABLE "WorkOrderRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signoffId" TEXT,
    "doneAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderRequest_userId_doneAt_idx" ON "WorkOrderRequest"("userId", "doneAt");

-- CreateIndex
CREATE INDEX "WorkOrderRequest_projectId_idx" ON "WorkOrderRequest"("projectId");

-- AddForeignKey
ALTER TABLE "WorkOrderRequest" ADD CONSTRAINT "WorkOrderRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderRequest" ADD CONSTRAINT "WorkOrderRequest_signoffId_fkey" FOREIGN KEY ("signoffId") REFERENCES "WorkOrderSignoff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

