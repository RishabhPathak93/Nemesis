-- Per-org SMTP transport. Adds a single table; one row per org max
-- (orgId is unique). Encrypted password stored in authPass via lib/crypto.
CREATE TABLE "SmtpConfig" (
    "id"            TEXT NOT NULL,
    "orgId"         TEXT NOT NULL,
    "enabled"       BOOLEAN NOT NULL DEFAULT false,
    "host"          TEXT NOT NULL,
    "port"          INTEGER NOT NULL DEFAULT 587,
    "secure"        BOOLEAN NOT NULL DEFAULT false,
    "authUser"      TEXT,
    "authPass"      TEXT,
    "fromAddress"   TEXT NOT NULL,
    "replyTo"       TEXT,
    "lastTestAt"    TIMESTAMP(3),
    "lastTestOk"    BOOLEAN,
    "lastTestError" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmtpConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmtpConfig_orgId_key" ON "SmtpConfig"("orgId");

ALTER TABLE "SmtpConfig" ADD CONSTRAINT "SmtpConfig_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
