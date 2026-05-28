-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "engineVersion" TEXT NOT NULL DEFAULT 'v1';

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseHeaders" JSONB,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "configEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'AGENT',
    "agentId" TEXT,
    "cronExpr" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "format" TEXT NOT NULL DEFAULT 'HTML',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReportRun" (
    "id" TEXT NOT NULL,
    "scheduledReportId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "reportId" TEXT,
    "errorMessage" TEXT,
    "channelResults" JSONB,

    CONSTRAINT "ScheduledReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamlConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idpEntityId" TEXT NOT NULL,
    "idpSsoUrl" TEXT NOT NULL,
    "idpSloUrl" TEXT,
    "idpCertificate" TEXT NOT NULL,
    "idpCertificate2" TEXT,
    "spEntityId" TEXT NOT NULL,
    "spAcsUrl" TEXT NOT NULL,
    "emailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attrEmail" TEXT NOT NULL DEFAULT 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    "attrName" TEXT NOT NULL DEFAULT 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    "jitProvision" BOOLEAN NOT NULL DEFAULT true,
    "defaultRole" "Role" NOT NULL DEFAULT 'VIEWER',
    "allowIdpInitiated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamlSession" (
    "id" TEXT NOT NULL,
    "samlConfigId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "redirectAfter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "SamlSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamlAssertionSeen" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assertionId" TEXT NOT NULL,
    "notOnOrAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SamlAssertionSeen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT,
    "threadId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ssoOnly" BOOLEAN NOT NULL DEFAULT false,
    "allowedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUsage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "testRunsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "agentCount" INTEGER NOT NULL DEFAULT 0,
    "apiKeyCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledReportCount" INTEGER NOT NULL DEFAULT 0,
    "capTestRunsPerMonth" INTEGER,
    "capAgents" INTEGER,
    "capApiKeys" INTEGER,
    "capScheduledReports" INTEGER,
    "resetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "downloadPath" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "PrivacyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Webhook_orgId_enabled_idx" ON "Webhook"("orgId", "enabled");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_webhookId_eventId_key" ON "WebhookDelivery"("webhookId", "eventId");

-- CreateIndex
CREATE INDEX "NotificationChannel_orgId_kind_enabled_idx" ON "NotificationChannel"("orgId", "kind", "enabled");

-- CreateIndex
CREATE INDEX "ScheduledReport_orgId_enabled_nextRunAt_idx" ON "ScheduledReport"("orgId", "enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledReportRun_scheduledReportId_startedAt_idx" ON "ScheduledReportRun"("scheduledReportId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SamlConfig_orgId_key" ON "SamlConfig"("orgId");

-- CreateIndex
CREATE INDEX "SamlConfig_enabled_idx" ON "SamlConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SamlSession_requestId_key" ON "SamlSession"("requestId");

-- CreateIndex
CREATE INDEX "SamlSession_samlConfigId_createdAt_idx" ON "SamlSession"("samlConfigId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SamlAssertionSeen_assertionId_key" ON "SamlAssertionSeen"("assertionId");

-- CreateIndex
CREATE INDEX "SamlAssertionSeen_orgId_notOnOrAfter_idx" ON "SamlAssertionSeen"("orgId", "notOnOrAfter");

-- CreateIndex
CREATE INDEX "ConversationTurn_threadId_turn_idx" ON "ConversationTurn"("threadId", "turn");

-- CreateIndex
CREATE INDEX "ConversationTurn_testRunId_idx" ON "ConversationTurn"("testRunId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPolicy_orgId_key" ON "OrgPolicy"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUsage_orgId_key" ON "OrgUsage"("orgId");

-- CreateIndex
CREATE INDEX "ImpersonationSession_orgId_expiresAt_idx" ON "ImpersonationSession"("orgId", "expiresAt");

-- CreateIndex
CREATE INDEX "ImpersonationSession_targetUserId_createdAt_idx" ON "ImpersonationSession"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_orgId_status_idx" ON "DataSubjectRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_userId_idx" ON "DataSubjectRequest"("userId");

-- CreateIndex
CREATE INDEX "PrivacyAcceptance_userId_idx" ON "PrivacyAcceptance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyAcceptance_userId_docType_version_key" ON "PrivacyAcceptance"("userId", "docType", "version");

-- CreateIndex
CREATE INDEX "Agent_orgId_createdAt_idx" ON "Agent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Agent_orgId_deletedAt_idx" ON "Agent"("orgId", "deletedAt");

-- CreateIndex
CREATE INDEX "TestRun_suiteId_createdAt_idx" ON "TestRun"("suiteId", "createdAt");

-- CreateIndex
CREATE INDEX "TestRun_status_createdAt_idx" ON "TestRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReportRun" ADD CONSTRAINT "ScheduledReportRun_scheduledReportId_fkey" FOREIGN KEY ("scheduledReportId") REFERENCES "ScheduledReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlConfig" ADD CONSTRAINT "SamlConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlSession" ADD CONSTRAINT "SamlSession_samlConfigId_fkey" FOREIGN KEY ("samlConfigId") REFERENCES "SamlConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPolicy" ADD CONSTRAINT "OrgPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUsage" ADD CONSTRAINT "OrgUsage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
