-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "secretPrevious" TEXT,
ADD COLUMN     "secretPreviousExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OidcConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['openid', 'profile', 'email']::TEXT[],
    "emailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jitProvision" BOOLEAN NOT NULL DEFAULT true,
    "defaultRole" "Role" NOT NULL DEFAULT 'VIEWER',
    "claimEmail" TEXT NOT NULL DEFAULT 'email',
    "claimName" TEXT NOT NULL DEFAULT 'name',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidcSession" (
    "id" TEXT NOT NULL,
    "oidcConfigId" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirectAfter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "OidcSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebauthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" BYTEA NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceLabel" TEXT NOT NULL,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backupEligible" BOOLEAN NOT NULL DEFAULT false,
    "backupState" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebauthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebauthnChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebauthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OidcConfig_orgId_key" ON "OidcConfig"("orgId");

-- CreateIndex
CREATE INDEX "OidcConfig_enabled_idx" ON "OidcConfig"("enabled");

-- CreateIndex
CREATE INDEX "OidcSession_oidcConfigId_createdAt_idx" ON "OidcSession"("oidcConfigId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebauthnCredential_credentialId_key" ON "WebauthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebauthnCredential_userId_idx" ON "WebauthnCredential"("userId");

-- CreateIndex
CREATE INDEX "WebauthnChallenge_userId_expiresAt_idx" ON "WebauthnChallenge"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "OidcConfig" ADD CONSTRAINT "OidcConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OidcSession" ADD CONSTRAINT "OidcSession_oidcConfigId_fkey" FOREIGN KEY ("oidcConfigId") REFERENCES "OidcConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
