-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'OFFICE_ADMIN';
-- CreateTable
CREATE TABLE "BillingSheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL DEFAULT '',
    "readyAt" TIMESTAMP(3),
    "readyById" TEXT,
    "billedAt" TIMESTAMP(3),
    "billedById" TEXT,
    "qbInvoiceNo" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingSheet_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BillingSheetLine" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "date" DATE,
    "who" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(12,2),
    CONSTRAINT "BillingSheetLine_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "BillingSheet_projectId_key" ON "BillingSheet"("projectId");
-- CreateIndex
CREATE INDEX "BillingSheet_status_idx" ON "BillingSheet"("status");
-- AddForeignKey
ALTER TABLE "BillingSheet" ADD CONSTRAINT "BillingSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BillingSheetLine" ADD CONSTRAINT "BillingSheetLine_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "BillingSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
