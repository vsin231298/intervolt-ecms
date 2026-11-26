-- Lead per service call replaces the per-employee "helper only" flag
ALTER TABLE "Worker" DROP COLUMN "helperOnly";
ALTER TABLE "Project" ADD COLUMN "serviceLeadUserId" TEXT;
