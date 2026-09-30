DROP INDEX IF EXISTS "Email_idempotencyKey_key";

CREATE UNIQUE INDEX "Email_userId_idempotencyKey_key"
ON "Email"("userId", "idempotencyKey");
