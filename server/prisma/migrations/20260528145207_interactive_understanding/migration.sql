-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "understandingError" TEXT,
ADD COLUMN     "understandingStatus" TEXT DEFAULT 'idle',
ADD COLUMN     "understandingTranscript" JSONB;
