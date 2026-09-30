ALTER TABLE "Email"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sending_started_at" TIMESTAMP(3),
  ADD COLUMN "message_id" TEXT,
  ADD COLUMN "hourly_limit" INTEGER;
