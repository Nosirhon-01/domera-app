-- Replaces the Eskiz SMS login codes with phone registration challenges.
-- otp_codes only held short-lived (120 s) login codes, so dropping it loses no user data.
-- No other table is touched.

-- DropTable
DROP TABLE IF EXISTS "otp_codes";

-- CreateTable
CREATE TABLE IF NOT EXISTS "registration_challenges" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "registration_challenges_tokenHash_key" ON "registration_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registration_challenges_phone_createdAt_idx" ON "registration_challenges"("phone", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registration_challenges_createdAt_idx" ON "registration_challenges"("createdAt");
