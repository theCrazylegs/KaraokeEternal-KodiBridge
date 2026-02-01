-- Up
ALTER TABLE "queue" ADD COLUMN "data" TEXT DEFAULT NULL;

-- Down
ALTER TABLE "queue" DROP COLUMN "data";
