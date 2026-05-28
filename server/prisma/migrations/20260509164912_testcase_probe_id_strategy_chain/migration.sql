-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "probeId" TEXT,
ADD COLUMN     "strategyChain" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "TestCase_probeId_idx" ON "TestCase"("probeId");

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_probeId_fkey" FOREIGN KEY ("probeId") REFERENCES "Probe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
