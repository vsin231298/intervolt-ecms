-- Notes added to a submitted work order (original stays unchanged)
CREATE TABLE "WorkOrderNote" (
    "id" TEXT NOT NULL,
    "signoffId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkOrderNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkOrderNote_signoffId_idx" ON "WorkOrderNote"("signoffId");
ALTER TABLE "WorkOrderNote" ADD CONSTRAINT "WorkOrderNote_signoffId_fkey" FOREIGN KEY ("signoffId") REFERENCES "WorkOrderSignoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
