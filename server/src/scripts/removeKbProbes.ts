/**
 * One-shot cleanup: remove the cortexview_kb-sourced probes that were
 * ingested via `ingestKb.ts`. Their compliance mappings cascade-delete;
 * any TestCase backrefs are nulled out (onDelete: SetNull).
 *
 * Run: npx tsx src/scripts/removeKbProbes.ts
 */
import { prisma } from '../lib/prisma';

async function main() {
  const before = await prisma.probe.count({ where: { source: 'cortexview_kb' } });
  console.log(`Found ${before} probes with source="cortexview_kb"`);
  if (before === 0) {
    console.log('Nothing to delete.');
    return;
  }
  const { count } = await prisma.probe.deleteMany({ where: { source: 'cortexview_kb' } });
  console.log(`Deleted ${count} probes.`);
  const after = await prisma.probe.count({ where: { source: 'cortexview_kb' } });
  console.log(`Remaining cortexview_kb probes: ${after}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
