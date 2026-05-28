-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "disabledProbeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "BrandingProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "primaryColor" TEXT,
    "logoMime" TEXT,
    "logoSizeBytes" INTEGER,
    "logoStoragePath" TEXT,
    "logoChecksum" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "BrandingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Probe" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "seedPayload" TEXT NOT NULL,
    "expectedFailIndicators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedPassIndicators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicability" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultDetectorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultStrategies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Probe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "implFn" TEXT,
    "orchestratorClass" TEXT,
    "paramSchema" JSONB,
    "defaultParams" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detector" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Detector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemCount" INTEGER NOT NULL,
    "licenseUrl" TEXT,
    "citation" TEXT,

    CONSTRAINT "DatasetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetItem" (
    "id" TEXT NOT NULL,
    "datasetSnapshotId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expectedHarm" TEXT,
    "category" TEXT,
    "metadata" JSONB,
    "probeId" TEXT,

    CONSTRAINT "DatasetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbeComplianceMapping" (
    "id" TEXT NOT NULL,
    "probeId" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ProbeComplianceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerticalPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "probeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedStrategies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerticalPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandingProfile_orgId_key" ON "BrandingProfile"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Probe_slug_key" ON "Probe"("slug");

-- CreateIndex
CREATE INDEX "Probe_source_category_idx" ON "Probe"("source", "category");

-- CreateIndex
CREATE INDEX "Probe_severity_idx" ON "Probe"("severity");

-- CreateIndex
CREATE INDEX "Probe_enabled_idx" ON "Probe"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_slug_key" ON "Strategy"("slug");

-- CreateIndex
CREATE INDEX "Strategy_family_enabled_idx" ON "Strategy"("family", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Detector_slug_key" ON "Detector"("slug");

-- CreateIndex
CREATE INDEX "Detector_kind_enabled_idx" ON "Detector"("kind", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSnapshot_source_version_key" ON "DatasetSnapshot"("source", "version");

-- CreateIndex
CREATE INDEX "DatasetItem_datasetSnapshotId_category_idx" ON "DatasetItem"("datasetSnapshotId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetItem_datasetSnapshotId_externalId_key" ON "DatasetItem"("datasetSnapshotId", "externalId");

-- CreateIndex
CREATE INDEX "ProbeComplianceMapping_framework_controlId_idx" ON "ProbeComplianceMapping"("framework", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ProbeComplianceMapping_probeId_framework_controlId_key" ON "ProbeComplianceMapping"("probeId", "framework", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "VerticalPack_slug_key" ON "VerticalPack"("slug");

-- AddForeignKey
ALTER TABLE "BrandingProfile" ADD CONSTRAINT "BrandingProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetItem" ADD CONSTRAINT "DatasetItem_datasetSnapshotId_fkey" FOREIGN KEY ("datasetSnapshotId") REFERENCES "DatasetSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetItem" ADD CONSTRAINT "DatasetItem_probeId_fkey" FOREIGN KEY ("probeId") REFERENCES "Probe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbeComplianceMapping" ADD CONSTRAINT "ProbeComplianceMapping_probeId_fkey" FOREIGN KEY ("probeId") REFERENCES "Probe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
