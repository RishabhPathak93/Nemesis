-- v2.1 — Browser-driven chat agents (Playwright adapter)
-- Add nullable columns to Agent so web_chat agents can store login URL,
-- chat URL, CSS selectors, timing knobs, and an encrypted password.
ALTER TABLE "Agent" ADD COLUMN "browserConfig" JSONB;
ALTER TABLE "Agent" ADD COLUMN "browserPasswordEnc" TEXT;
