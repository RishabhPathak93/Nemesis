-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "relevanceWeights" JSONB,
ADD COLUMN     "relevanceWeightsHash" TEXT;
