const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const args = [npmCli, 'audit', '--json', '--fetch-retries=0', '--fetch-timeout=15000'];
if (process.argv.includes('--production')) args.push('--omit=dev');
const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
let report;
try { report = JSON.parse(result.stdout); } catch { console.error('Could not query npm advisory database.'); process.exit(1); }
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(process.argv.includes('--production') ? 'reports/dependency-audit-production.json' : 'reports/dependency-audit.json', JSON.stringify(report, null, 2));
if (!report.metadata) { console.error('Dependency audit request failed.'); process.exit(1); }
console.log(JSON.stringify({ counts: report.metadata.vulnerabilities, packages: Object.values(report.vulnerabilities).map(v => ({
  name: v.name, severity: v.severity, direct: v.isDirect, fix: v.fixAvailable,
  advisories: v.via.filter(a => typeof a === 'object').map(a => ({ title: a.title, range: a.range }))
})) }, null, 2));
process.exitCode = report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical > 0 ? 1 : 0;
