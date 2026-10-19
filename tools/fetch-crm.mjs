// Dev helper: log in with .env and save CRM answers to files.
//   node tools/fetch-crm.mjs "/api/design-requests" out.json   one response
//   node tools/fetch-crm.mjs samples [dir]                      the selftest's samples (default engine/sample):
//     design-requests.json, rules.json, work-calendar.json, designer-steps/<from>_<to>.json (the windows the
//     periods read), frozen/<from>_<to>.json (closed periods' frozen designer records), purchase/<period>.json
//     (hr-erp's Purchase MIS report of each period, as the TV reads it) and meta.json { now, readAt }.
process.env.TZ = 'Asia/Kolkata';
const { default: dotenv } = await import('dotenv');
const path = await import('node:path');
const fs = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
const { createCrmClient } = await import('../lib/crmClient.js');
const { createPurchaseSource } = await import('../lib/purchaseSource.js');
const { DESIGNER_PROFILE, MIS_PERIODS, designerStepRanges, frozenDesignPeriodsWanted, misPeriodOf } = await import('../engine/index.js');

const [apiPath, outFile] = process.argv.slice(2);
if (!apiPath || (apiPath !== 'samples' && !outFile)) {
  console.error('Usage: node tools/fetch-crm.mjs "/api/..." out.json   |   node tools/fetch-crm.mjs samples [dir]');
  process.exit(1);
}
const client = createCrmClient({
  baseUrl: process.env.CRM_BASE_URL.replace(/\/+$/, ''),
  apiKey: process.env.FIREBASE_API_KEY,
  email: process.env.CRM_EMAIL,
  password: process.env.CRM_PASSWORD,
});

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  console.error(`saved ${path.relative(root, file)} (${fs.statSync(file).size} bytes)`);
}
const save = async (api, file) => write(file, await client.getJson(api, { timeoutMs: 130_000 }));

if (apiPath !== 'samples') {
  await save(apiPath, outFile);
} else {
  // The clock is pinned to the fetch time so the selftest rebuilds the same windows later.
  const dir = path.resolve(outFile || path.join(root, 'engine', 'sample'));
  const now = new Date();
  await save('/api/design-requests', path.join(dir, 'design-requests.json'));
  const readAt = new Date();
  await save('/api/rules/resolved', path.join(dir, 'rules.json'));
  await save('/api/work-calendar', path.join(dir, 'work-calendar.json'));
  for (const r of designerStepRanges(now)) {
    await save(`/api/designer-steps?from=${r.from}&to=${r.to}`, path.join(dir, 'designer-steps', `${r.from}_${r.to}.json`));
  }
  const rules = JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf8'));
  for (const { key, period } of frozenDesignPeriodsWanted(rules, now)) {
    const json = await client.getJson(`/api/mis/periods?from=${period.from}&to=${period.to}&profile=${DESIGNER_PROFILE}`, { timeoutMs: 130_000 });
    write(path.join(dir, 'frozen', `${key}.json`), json.records[DESIGNER_PROFILE]);
  }
  const purchase = createPurchaseSource({ client });
  for (const { key, label } of MIS_PERIODS) {
    const { report, via, note } = await purchase.load(misPeriodOf(key, now), label);
    if (note) console.error(`purchase ${key}: ${note}`);
    write(path.join(dir, 'purchase', `${key}.json`), { via, report });
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify({ now: now.toISOString(), readAt: readAt.toISOString() }, null, 2)}\n`);
}
