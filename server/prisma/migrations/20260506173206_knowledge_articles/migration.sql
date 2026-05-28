-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "severity" TEXT NOT NULL,
    "cvssEstimate" DOUBLE PRECISION,
    "targets" TEXT[],
    "attackVector" TEXT,
    "preconditions" TEXT,
    "description" TEXT NOT NULL,
    "payloads" JSONB NOT NULL,
    "variations" JSONB NOT NULL,
    "expectedVulnerableBehavior" TEXT,
    "expectedSafeBehavior" TEXT,
    "detectionSignatures" JSONB,
    "automationHints" JSONB,
    "mitigations" JSONB,
    "referenceUrls" JSONB,
    "frameworks" JSONB,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_externalId_key" ON "KnowledgeArticle"("externalId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_category_idx" ON "KnowledgeArticle"("category");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_severity_idx" ON "KnowledgeArticle"("severity");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_orgId_category_idx" ON "KnowledgeArticle"("orgId", "category");

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
