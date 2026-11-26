-- "Going to office" at clock-out, "Done at office" later
ALTER TABLE "ClockEntry" ADD COLUMN "toOffice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClockEntry" ADD COLUMN "officeDoneAt" TIMESTAMP(3);
ALTER TABLE "ClockEntry" ADD COLUMN "officeLat" DOUBLE PRECISION;
ALTER TABLE "ClockEntry" ADD COLUMN "officeLng" DOUBLE PRECISION;
