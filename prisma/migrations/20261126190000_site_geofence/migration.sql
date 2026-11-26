-- Site pin and optional clock-in radius per job (field geofence)
ALTER TABLE "Project" ADD COLUMN "siteLat" DOUBLE PRECISION,
ADD COLUMN "siteLng" DOUBLE PRECISION,
ADD COLUMN "geofenceRadiusM" INTEGER;
