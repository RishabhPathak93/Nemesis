import { seedSecurityEngine } from '../securityEngine/seed';
import { prisma } from '../lib/prisma';

async function main(): Promise<void> {
  const counts = await seedSecurityEngine();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, ...counts }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed failed:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
