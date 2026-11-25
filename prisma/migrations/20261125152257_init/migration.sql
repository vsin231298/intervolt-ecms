-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PROJECT_MANAGER', 'ESTIMATOR', 'PROCUREMENT', 'ACCOUNTING', 'SITE_SUPERVISOR', 'ELECTRICIAN', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('OPPORTUNITY', 'UNDER_REVIEW', 'ESTIMATING', 'QUOTING', 'READY_TO_SUBMIT', 'SUBMITTED', 'ACTIVATION', 'EXECUTION', 'CLOSEOUT', 'CLOSED');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('NOT_DOABLE', 'LOST_BID', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('CLIENT', 'CONSULTANT', 'GENERAL_CONTRACTOR', 'SUPPLIER', 'SUBCONTRACTOR', 'INSPECTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('DOABLE', 'NOT_DOABLE');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'FINAL', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LineCategory" AS ENUM ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'SUBCONTRACT');

-- CreateEnum
CREATE TYPE "RfqSupplierStatus" AS ENUM ('PENDING', 'RECEIVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SubmissionOutcome" AS ENUM ('PENDING', 'AWARDED', 'NOT_AWARDED');

-- CreateEnum
CREATE TYPE "ShopDrawingStatus" AS ENUM ('IN_PREPARATION', 'INTERNAL_REVIEW', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_AS_NOTED', 'REVISE_AND_RESUBMIT');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RfiStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DrawStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'INVOICED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('SCHEDULED', 'PASSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeficiencyStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CloseoutStatus" AS ENUM ('OPEN', 'COMPLETE', 'WAIVED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "CommissioningResult" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('RECEIVED', 'APPROVED', 'PAID', 'DISPUTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "projectId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "tenderNumber" TEXT NOT NULL,
    "jobNumber" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "clientId" TEXT,
    "consultantId" TEXT,
    "gcId" TEXT,
    "clientProjectNo" TEXT,
    "estimatedValue" DECIMAL(14,2),
    "invitationDate" DATE,
    "submissionDeadline" TIMESTAMP(3),
    "siteVisitDate" TIMESTAMP(3),
    "stage" "ProjectStage" NOT NULL DEFAULT 'OPPORTUNITY',
    "closeReason" "CloseReason",
    "closeNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "estimatorId" TEXT,
    "projectManagerId" TEXT,
    "startDate" DATE,
    "finishDate" DATE,
    "holdbackPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStage" "ProjectStage",
    "toStage" "ProjectStage" NOT NULL,
    "note" TEXT,
    "byId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reason" TEXT,
    "reviewerId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "fromParty" TEXT,
    "toParty" TEXT,
    "summary" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFolder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "folderId" TEXT,
    "module" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "revisionLabel" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "note" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NONE',
    "approvedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "labourRate" DECIMAL(10,2) NOT NULL,
    "overheadPercent" DECIMAL(5,2) NOT NULL,
    "profitPercent" DECIMAL(5,2) NOT NULL,
    "notes" TEXT,
    "basedOnId" TEXT,
    "materialTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "labourHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labourTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "equipmentTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subcontractTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overheadAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "profitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sellPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "category" "LineCategory" NOT NULL,
    "section" TEXT,
    "description" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ea',
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labourHoursPerUnit" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "supplierQuoteLineId" TEXT,
    "materialTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "labourHours" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequestItem" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "estimateLineId" TEXT,
    "description" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "selectedQuoteLineId" TEXT,

    CONSTRAINT "QuoteRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequestSupplier" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "followUpDate" DATE,
    "lastFollowUpAt" TIMESTAMP(3),
    "status" "RfqSupplierStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "QuoteRequestSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "quoteDate" DATE NOT NULL,
    "validUntil" DATE,
    "leadTimeDays" INTEGER,
    "freight" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuoteLine" (
    "id" TEXT NOT NULL,
    "supplierQuoteId" TEXT NOT NULL,
    "rfqItemId" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "leadTimeDays" INTEGER,
    "note" TEXT,

    CONSTRAINT "SupplierQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderSubmission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "finalPrice" DECIMAL(14,2) NOT NULL,
    "priceApprovedById" TEXT,
    "priceApprovedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedAmount" DECIMAL(14,2),
    "submissionMethod" TEXT,
    "outcome" "SubmissionOutcome" NOT NULL DEFAULT 'PENDING',
    "outcomeDate" TIMESTAMP(3),
    "outcomeReason" TEXT,
    "winningAmount" DECIMAL(14,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalValue" DECIMAL(14,2) NOT NULL,
    "currentValue" DECIMAL(14,2) NOT NULL,
    "clientPoNumber" TEXT NOT NULL,
    "poDate" DATE,
    "awardedEstimateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractValueChange" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "changeOrderId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "previousValue" DECIMAL(14,2) NOT NULL,
    "newValue" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractValueChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPO" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poDate" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopDrawing" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specSection" TEXT,
    "requiredForProcurement" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopDrawingRevision" (
    "id" TEXT NOT NULL,
    "shopDrawingId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "ShopDrawingStatus" NOT NULL DEFAULT 'IN_PREPARATION',
    "preparedById" TEXT,
    "internalReviewAt" TIMESTAMP(3),
    "internalReviewById" TEXT,
    "internalReviewNotes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "requiredBy" DATE,
    "returnedAt" TIMESTAMP(3),
    "consultantComments" TEXT,
    "approvedAt" TIMESTAMP(3),
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopDrawingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateLineId" TEXT,
    "description" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "unit" TEXT NOT NULL,
    "quantityRequired" DECIMAL(12,2) NOT NULL,
    "budgetUnitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierQuoteId" TEXT,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "expectedDelivery" DATE,
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "materialItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "expectedDate" DATE,
    "quantityReceived" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receivedAt" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "paidAt" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "licenceNo" TEXT,
    "phone" TEXT,
    "regularRate" DECIMAL(10,2) NOT NULL,
    "overtimeRate" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabourAssignment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "notes" TEXT,

    CONSTRAINT "LabourAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "regularHours" DECIMAL(5,2) NOT NULL,
    "overtimeHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "regularRate" DECIMAL(10,2) NOT NULL,
    "overtimeRate" DECIMAL(10,2) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "costCode" TEXT,
    "changeOrderId" TEXT,
    "description" TEXT,
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weather" TEXT,
    "manpower" INTEGER NOT NULL DEFAULT 0,
    "workPerformed" TEXT NOT NULL,
    "delays" TEXT,
    "safetyNotes" TEXT,
    "visitors" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfi" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "requiredBy" DATE,
    "responsibleId" TEXT,
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "changeRequired" BOOLEAN,
    "status" "RfiStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Esi" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuedBy" TEXT,
    "receivedAt" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "changeRequired" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Esi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rfiId" TEXT,
    "esiId" TEXT,
    "materialCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "labourHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "labourRate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "labourCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "markupPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "proposedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvedAmount" DECIMAL(14,2),
    "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
    "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "clientReference" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeOrderLine" (
    "id" TEXT NOT NULL,
    "changeOrderId" TEXT NOT NULL,
    "category" "LineCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ea',
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labourHoursPerUnit" DECIMAL(10,3) NOT NULL DEFAULT 0,

    CONSTRAINT "ChangeOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "scheduledValue" DECIMAL(14,2) NOT NULL,
    "changeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressDraw" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "drawNumber" INTEGER NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "DrawStatus" NOT NULL DEFAULT 'DRAFT',
    "thisPeriod" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "holdback" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawLine" (
    "id" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "billingLineId" TEXT NOT NULL,
    "previousAmount" DECIMAL(14,2) NOT NULL,
    "thisPeriodAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "DrawLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientPoId" TEXT,
    "drawId" TEXT,
    "description" TEXT,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "holdback" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL(5,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "approvedAmount" DECIMAL(14,2),
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "isHoldbackRelease" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "receivedAt" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isEsa" BOOLEAN NOT NULL DEFAULT false,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "inspector" TEXT,
    "esaNotificationNo" TEXT,
    "result" "InspectionResult" NOT NULL DEFAULT 'SCHEDULED',
    "resultDate" TIMESTAMP(3),
    "notes" TEXT,
    "reinspectionOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deficiency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inspectionId" TEXT,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "assignedToId" TEXT,
    "dueDate" DATE,
    "status" "DeficiencyStatus" NOT NULL DEFAULT 'OPEN',
    "correctiveAction" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deficiency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissioningItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "test" TEXT NOT NULL,
    "scheduledAt" DATE,
    "performedAt" DATE,
    "performedBy" TEXT,
    "result" "CommissioningResult" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissioningItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseoutItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "autoCheck" TEXT,
    "status" "CloseoutStatus" NOT NULL DEFAULT 'OPEN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "waiverReason" TEXT,
    "notes" TEXT,

    CONSTRAINT "CloseoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "projectId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_at_idx" ON "AuditLog"("projectId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "Organization_type_name_idx" ON "Organization"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenderNumber_key" ON "Project"("tenderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Project_jobNumber_key" ON "Project"("jobNumber");

-- CreateIndex
CREATE INDEX "Project_stage_idx" ON "Project"("stage");

-- CreateIndex
CREATE INDEX "Project_submissionDeadline_idx" ON "Project"("submissionDeadline");

-- CreateIndex
CREATE INDEX "StageHistory_projectId_at_idx" ON "StageHistory"("projectId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFolder_projectId_name_key" ON "DocumentFolder"("projectId", "name");

-- CreateIndex
CREATE INDEX "Document_projectId_module_idx" ON "Document"("projectId", "module");

-- CreateIndex
CREATE INDEX "Document_entityType_entityId_idx" ON "Document"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_revision_key" ON "DocumentVersion"("documentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_projectId_revision_key" ON "Estimate"("projectId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_projectId_number_key" ON "QuoteRequest"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequestItem_selectedQuoteLineId_key" ON "QuoteRequestItem"("selectedQuoteLineId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequestSupplier_quoteRequestId_supplierId_key" ON "QuoteRequestSupplier"("quoteRequestId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuoteLine_supplierQuoteId_rfqItemId_key" ON "SupplierQuoteLine"("supplierQuoteId", "rfqItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_projectId_key" ON "Contract"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractValueChange_changeOrderId_key" ON "ContractValueChange"("changeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPO_projectId_poNumber_key" ON "ClientPO"("projectId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ShopDrawing_projectId_number_key" ON "ShopDrawing"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ShopDrawingRevision_shopDrawingId_revision_key" ON "ShopDrawingRevision"("shopDrawingId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_supplierId_invoiceNumber_key" ON "SupplierInvoice"("supplierId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_userId_key" ON "Worker"("userId");

-- CreateIndex
CREATE INDEX "LabourAssignment_date_idx" ON "LabourAssignment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LabourAssignment_workerId_projectId_date_key" ON "LabourAssignment"("workerId", "projectId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_date_idx" ON "TimeEntry"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_workerId_projectId_date_costCode_key" ON "TimeEntry"("workerId", "projectId", "date", "costCode");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_projectId_date_key" ON "DailyReport"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Rfi_projectId_number_key" ON "Rfi"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Esi_projectId_number_key" ON "Esi"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeOrder_projectId_number_key" ON "ChangeOrder"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLine_changeOrderId_key" ON "BillingLine"("changeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressDraw_projectId_drawNumber_key" ON "ProgressDraw"("projectId", "drawNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DrawLine_drawId_billingLineId_key" ON "DrawLine"("drawId", "billingLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_drawId_key" ON "Invoice"("drawId");

-- CreateIndex
CREATE INDEX "Deficiency_projectId_status_idx" ON "Deficiency"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutItem_projectId_key_key" ON "CloseoutItem"("projectId", "key");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_gcId_fkey" FOREIGN KEY ("gcId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_estimatorId_fkey" FOREIGN KEY ("estimatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderReview" ADD CONSTRAINT "TenderReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestItem" ADD CONSTRAINT "QuoteRequestItem_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestItem" ADD CONSTRAINT "QuoteRequestItem_estimateLineId_fkey" FOREIGN KEY ("estimateLineId") REFERENCES "EstimateLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestItem" ADD CONSTRAINT "QuoteRequestItem_selectedQuoteLineId_fkey" FOREIGN KEY ("selectedQuoteLineId") REFERENCES "SupplierQuoteLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestSupplier" ADD CONSTRAINT "QuoteRequestSupplier_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestSupplier" ADD CONSTRAINT "QuoteRequestSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuoteLine" ADD CONSTRAINT "SupplierQuoteLine_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "SupplierQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuoteLine" ADD CONSTRAINT "SupplierQuoteLine_rfqItemId_fkey" FOREIGN KEY ("rfqItemId") REFERENCES "QuoteRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderSubmission" ADD CONSTRAINT "TenderSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderSubmission" ADD CONSTRAINT "TenderSubmission_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractValueChange" ADD CONSTRAINT "ContractValueChange_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractValueChange" ADD CONSTRAINT "ContractValueChange_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPO" ADD CONSTRAINT "ClientPO_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopDrawing" ADD CONSTRAINT "ShopDrawing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopDrawingRevision" ADD CONSTRAINT "ShopDrawingRevision_shopDrawingId_fkey" FOREIGN KEY ("shopDrawingId") REFERENCES "ShopDrawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialItem" ADD CONSTRAINT "MaterialItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialItem" ADD CONSTRAINT "MaterialItem_estimateLineId_fkey" FOREIGN KEY ("estimateLineId") REFERENCES "EstimateLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "SupplierQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "MaterialItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourAssignment" ADD CONSTRAINT "LabourAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourAssignment" ADD CONSTRAINT "LabourAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Esi" ADD CONSTRAINT "Esi_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "Rfi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_esiId_fkey" FOREIGN KEY ("esiId") REFERENCES "Esi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeOrderLine" ADD CONSTRAINT "ChangeOrderLine_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLine" ADD CONSTRAINT "BillingLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLine" ADD CONSTRAINT "BillingLine_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressDraw" ADD CONSTRAINT "ProgressDraw_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawLine" ADD CONSTRAINT "DrawLine_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "ProgressDraw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawLine" ADD CONSTRAINT "DrawLine_billingLineId_fkey" FOREIGN KEY ("billingLineId") REFERENCES "BillingLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientPoId_fkey" FOREIGN KEY ("clientPoId") REFERENCES "ClientPO"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "ProgressDraw"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deficiency" ADD CONSTRAINT "Deficiency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deficiency" ADD CONSTRAINT "Deficiency_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissioningItem" ADD CONSTRAINT "CommissioningItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
