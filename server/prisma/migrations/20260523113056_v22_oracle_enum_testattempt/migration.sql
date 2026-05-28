-- v2.2 foundation: Verdict enum, TestRun.seed + enumerationMode, TestAttempt table.
-- Existing TestResult.result values ('pass'/'fail'/'partial'/'error') are
-- already enum-valid so the column conversion is a no-data-loss USING cast.

-- 1) Create the Verdict enum.
CREATE TYPE "Verdict" AS ENUM ('pass', 'fail', 'partial', 'error');

-- 2) Backfill any rogue values to 'error' so the cast doesn't fail. (Defensive;
--    in current prod all rows are one of the four canonical values.)
UPDATE "TestResult" SET "result" = 'error'
WHERE "result" NOT IN ('pass', 'fail', 'partial', 'error');

-- 3) Convert TestResult.result from text → Verdict.
ALTER TABLE "TestResult"
    ALTER COLUMN "result" TYPE "Verdict" USING "result"::"Verdict";

-- 4) Add new TestRun columns. Defaults so existing rows are valid.
ALTER TABLE "TestRun"
    ADD COLUMN "seed"            TEXT NOT NULL DEFAULT '',
    ADD COLUMN "enumerationMode" TEXT NOT NULL DEFAULT 'llm';

-- 5) Create TestAttempt.
CREATE TABLE "TestAttempt" (
    "id"                TEXT NOT NULL,
    "resultId"          TEXT NOT NULL,
    "attemptNumber"     INTEGER NOT NULL,
    "transformedPrompt" TEXT NOT NULL,
    "appliedStrategies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "agentResponse"     TEXT NOT NULL,
    "verdict"           "Verdict" NOT NULL,
    "confidence"        DOUBLE PRECISION NOT NULL,
    "signals"           JSONB NOT NULL,
    "reevalOf"          TEXT,
    "parentAttemptId"   TEXT,
    "durationMs"        INTEGER NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TestAttempt_resultId_attemptNumber_idx"
    ON "TestAttempt"("resultId", "attemptNumber");

ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_resultId_fkey"
    FOREIGN KEY ("resultId") REFERENCES "TestResult"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
