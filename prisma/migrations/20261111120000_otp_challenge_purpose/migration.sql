-- OTP login (/auth/otp/*) shares registration_challenges with phone registration.
-- ADDITIVE ONLY: existing rows become purpose 'register' (what they are). No data is changed.

-- AlterTable
ALTER TABLE "registration_challenges" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'register';
