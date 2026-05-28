/*
  Warnings:

  - You are about to drop the `AttackPattern` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `KnowledgeArticle` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AttackPattern" DROP CONSTRAINT "AttackPattern_orgId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeArticle" DROP CONSTRAINT "KnowledgeArticle_orgId_fkey";

-- DropTable
DROP TABLE "AttackPattern";

-- DropTable
DROP TABLE "KnowledgeArticle";
