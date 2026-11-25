-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PROJECT', 'SMALL_JOB', 'SERVICE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('REQUIRED', 'ORDERED', 'RECEIVED', 'CANCELLED', 'INVOICED');

-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('REQUESTED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('NOT_CHECKED', 'MATCHED', 'VARIANCE');

-- CreateEnum
CREATE TYPE "FieldUpdateKind" AS ENUM ('UPDATE', 'ISSUE');

-- DropIndex
DROP INDEX "Project_jobNumber_key";

-- DropIndex
DROP INDEX "Project_tenderNumber_key";

-- DropIndex
DROP INDEX "TimeEntry_workerId_projectId_date_costCode_key";

-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "clientPoNumber" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "expiresAt" DATE,
ADD COLUMN     "workerId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "changeOrderId" TEXT;

-- AlterTable
ALTER TABLE "MaterialItem" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manualStatus" "MaterialStatus",
ADD COLUMN     "manualUnitCost" DECIMAL(12,2),
ADD COLUMN     "orderedAt" DATE,
ADD COLUMN     "orderedByName" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "jobNumber",
DROP COLUMN "tenderNumber",
ADD COLUMN     "jobType" "JobType" NOT NULL DEFAULT 'PROJECT',
ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "siteContactName" TEXT,
ADD COLUMN     "siteContactPhone" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "deliveryOverrideById" TEXT,
ADD COLUMN     "deliveryOverrideReason" TEXT,
ADD COLUMN     "materialRequestId" TEXT,
ADD COLUMN     "shopDrawingsRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShopDrawing" DROP COLUMN "requiredForProcurement",
ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "matchNote" TEXT,
ADD COLUMN     "matchStatus" "MatchStatus" NOT NULL DEFAULT 'NOT_CHECKED',
ADD COLUMN     "overrideReason" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "clockEntryId" TEXT,
ADD COLUMN     "editedById" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'TIMESHEET';

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "dueDate" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "projectId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventAttendee" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventAttendee_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "neededBy" DATE,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestLine" (
    "id" TEXT NOT NULL,
    "materialRequestId" TEXT NOT NULL,
    "materialItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ea',

    CONSTRAINT "MaterialRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialUsage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialItemId" TEXT,
    "workerId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ea',
    "usedOn" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "poLineId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClockEntry" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "inLat" DOUBLE PRECISION,
    "inLng" DOUBLE PRECISION,
    "outLat" DOUBLE PRECISION,
    "outLng" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "FieldUpdateKind" NOT NULL DEFAULT 'UPDATE',
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderSignoff" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "completedById" TEXT NOT NULL,
    "workSummary" TEXT NOT NULL,
    "markedComplete" BOOLEAN NOT NULL DEFAULT false,
    "customerName" TEXT,
    "signatureDocId" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "CalendarEvent_startsAt_idx" ON "CalendarEvent"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_projectId_number_key" ON "MaterialRequest"("projectId", "number");

-- CreateIndex
CREATE INDEX "ClockEntry_workerId_clockOutAt_idx" ON "ClockEntry"("workerId", "clockOutAt");

-- CreateIndex
CREATE INDEX "FieldUpdate_projectId_createdAt_idx" ON "FieldUpdate"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_number_key" ON "Project"("number");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_clockEntryId_key" ON "TimeEntry"("clockEntryId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopDrawing" ADD CONSTRAINT "ShopDrawing_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_clockEntryId_fkey" FOREIGN KEY ("clockEntryId") REFERENCES "ClockEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "MaterialItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "MaterialItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEntry" ADD CONSTRAINT "ClockEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEntry" ADD CONSTRAINT "ClockEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldUpdate" ADD CONSTRAINT "FieldUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldUpdate" ADD CONSTRAINT "FieldUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderSignoff" ADD CONSTRAINT "WorkOrderSignoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

