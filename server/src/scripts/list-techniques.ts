import { listTechniques, listSlugsByFamily } from '../securityEngine/strategies/registry';

const all = listTechniques();
const byFamily: Record<string, typeof all> = {};
for (const t of all) {
  byFamily[t.family] = byFamily[t.family] || [];
  byFamily[t.family].push(t);
}

console.log(JSON.stringify({
  total: all.length,
  byFamily: Object.fromEntries(
    Object.entries(byFamily).map(([k, v]) => [k, {
      count: v.length,
      slugs: v.map((t) => t.slug),
    }]),
  ),
}, null, 2));
