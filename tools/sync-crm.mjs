// Copies the CRM's own Designer MIS scoring into engine/crm/ as plain ES modules, so the TV
// scores the designers exactly like the CRM's Designer MIS page (app/(app)/reports/designer-mis)
// without needing the CRM checkout at run time.
//   node tools/sync-crm.mjs [path-to-CRM]     (default C:/Users/xyz/Desktop/CRM-APP-HRE-16, or CRM_SRC)
// The CRM is only READ. Copied: every module in ENTRIES and every CRM module they import,
// to engine/crm/<same path as in the CRM>. Each copy is verbatim except for a two-line header
// and its imports: '@/...' and extensionless imports become relative paths with the file's
// extension. Files under engine/crm/ that are no longer copied are removed. Run it again
// whenever the CRM changes that code, then `npm run selftest`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(process.argv[2] || process.env.CRM_SRC || 'C:/Users/xyz/Desktop/CRM-APP-HRE-16');
const outDir = path.join(root, 'engine', 'crm');

/* What engine/designMis.js imports from the CRM (the Designer MIS page's own modules). */
const ENTRIES = [
  'lib/designer-mis/report.js', // buildDesignRequestMisReport, frozenDesignerReportOf, gradesOf
  'lib/designer-mis/types.js', // DESIGNER_PROFILE
  'lib/mis/period.js', // the page's presets: This week, Last week, This month, Last month
  'lib/mis/frozen.js', // readsFrozen, frozenPeriodKey: a closed week or month is read from its record
  'lib/mis/step-delay.js', // averageDelayHours (the Avg delay card), stepDelayRows
  'lib/mis/delay-reasons.js', // topReasonByDoer
  'lib/mis/format.js', // fmtPct, fmtWorkingMinutes, scoreTone
  'lib/mis/score.js', // doerKeyOf
  'lib/mis/trend.js', // recentWeeks: the cylinder uploads are read for the period and the trend's weeks
  'lib/work-calendar.js', // setHolidays (hooks/useWorkCalendar.js)
  'lib/work-clock.js', // setClockRules (hooks/useWorkCalendar.js)
];
const SUFFIXES = ['', '.js', '.mjs', '/index.js', '/index.mjs'];
const SOURCE_FILE = 'SOURCE.json';

const posix = (p) => p.split(path.sep).join('/');
const fail = (message) => {
  console.error(`sync-crm: ${message}`);
  process.exit(1);
};

function existingFile(base) {
  for (const suffix of SUFFIXES) {
    try {
      if (fs.statSync(base + suffix).isFile()) return base + suffix;
    } catch {
      // try the next suffix
    }
  }
  return null;
}

function gitInfo() {
  try {
    const [commit, shortCommit, commitDate] = execFileSync('git', ['-C', src, 'log', '-1', '--format=%H%n%h%n%cI'], { encoding: 'utf8' })
      .trim().split('\n');
    return { commit, shortCommit, commitDate };
  } catch {
    return { commit: 'unknown', shortCommit: 'unknown', commitDate: null };
  }
}

/** Every import / export-from / dynamic import specifier in a module, with its source range. */
function importsOf(code, rel) {
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (err) {
    fail(`${rel}: cannot parse (${err.message})`);
  }
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    const isStatic = node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration'
      || (node.type === 'ExportNamedDeclaration' && node.source);
    if (isStatic) found.push(node.source);
    if (node.type === 'ImportExpression') {
      if (node.source.type !== 'Literal') fail(`${rel}: dynamic import of a computed path`);
      found.push(node.source);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === 'string') visit(value);
    }
  };
  visit(ast);
  return found.map((lit) => ({ spec: lit.value, start: lit.start, end: lit.end }));
}

/** The CRM file a specifier names, or a failure for anything the TV cannot copy. */
function resolveSpec(spec, fromFile, rel) {
  let base;
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = path.resolve(path.dirname(fromFile), spec);
  else fail(`${rel}: imports the package '${spec}' — copy only works for the CRM's own modules`);
  if (/\.json$/i.test(spec)) fail(`${rel}: imports JSON '${spec}'`);
  const target = existingFile(base);
  if (!target) fail(`${rel}: cannot resolve '${spec}'`);
  const inside = path.relative(src, target);
  if (inside.startsWith('..') || inside.split(path.sep).includes('node_modules')) fail(`${rel}: '${spec}' is outside the CRM's own code`);
  return target;
}

const destinationOf = (crmFile) => path.join(outDir, posix(path.relative(src, crmFile)));

if (!fs.existsSync(path.join(src, 'lib', 'designer-mis', 'report.js'))) fail(`no CRM checkout with lib/designer-mis at ${src}`);
const { commit, shortCommit, commitDate } = gitInfo();

/* Walk the import graph from the entries. */
const queue = ENTRIES.map((rel) => path.join(src, rel));
const modules = new Map(); // crm file -> { code, imports: [{ spec, start, end, target }] }
while (queue.length) {
  const file = queue.shift();
  if (modules.has(file)) continue;
  if (!fs.existsSync(file)) fail(`missing in the CRM: ${posix(path.relative(src, file))}`);
  const rel = posix(path.relative(src, file));
  const code = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const imports = importsOf(code, rel).map((imp) => ({ ...imp, target: resolveSpec(imp.spec, file, rel) }));
  modules.set(file, { code, imports });
  imports.forEach((imp) => { if (!modules.has(imp.target)) queue.push(imp.target); });
}

/* Write each copy with its imports made relative. */
const written = new Set();
let changed = 0;
for (const [file, { code, imports }] of modules) {
  const rel = posix(path.relative(src, file));
  const dest = destinationOf(file);
  let body = code;
  [...imports].sort((a, b) => b.start - a.start).forEach((imp) => {
    let relative = posix(path.relative(path.dirname(dest), destinationOf(imp.target)));
    if (!relative.startsWith('.')) relative = `./${relative}`;
    body = `${body.slice(0, imp.start)}'${relative}'${body.slice(imp.end)}`;
  });
  const header = `// VERBATIM COPY of CRM ${rel} @ ${shortCommit} ('@/...' imports made relative).\n`
    + '// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.\n';
  const text = header + body;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const before = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (before !== text) {
    fs.writeFileSync(dest, text);
    changed += 1;
  }
  written.add(path.resolve(dest));
}

/* Remove copies the CRM no longer needs (only inside engine/crm/). */
const removed = [];
function sweep(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sweep(full);
      if (!fs.readdirSync(full).length) fs.rmdirSync(full);
    } else if (!written.has(path.resolve(full)) && !(dir === outDir && entry.name === SOURCE_FILE)) {
      fs.unlinkSync(full);
      removed.push(posix(path.relative(root, full)));
    }
  }
}
sweep(outDir);

const files = [...modules.keys()].map((file) => posix(path.relative(src, file))).sort();
const source = { repo: path.basename(src), commit, shortCommit, commitDate, files };
fs.writeFileSync(path.join(outDir, SOURCE_FILE), `${JSON.stringify(source, null, 2)}\n`);

console.error(`sync-crm: ${files.length} CRM files @ ${shortCommit} (${changed} written, ${files.length - changed} unchanged)`
  + `${removed.length ? `; removed ${removed.length}: ${removed.join(', ')}` : ''}`);
