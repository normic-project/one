const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { keccak256 } = require('ethers');

const excludedDirectories = new Set([
  '.git', 'node_modules', 'artifacts', 'cache', 'dist', 'reports', 'test-results', 'playwright-report', 'deployments'
]);
const excludedFiles = new Set(['.env']);

function files(directory = '.') {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(directory === '.' ? '' : directory.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) result.push(...files(relative));
    } else if (!excludedFiles.has(entry.name) && !entry.name.endsWith('.log')) result.push(relative);
  }
  return result.sort();
}

function digest(selected) {
  const hash = crypto.createHash('sha256');
  for (const file of selected) {
    const content = fs.readFileSync(file);
    hash.update(Buffer.from(`${file.length}:${file}:${content.length}:`, 'utf8'));
    hash.update(content);
  }
  return `sha256:${hash.digest('hex')}`;
}

const selected = files();
const productionContracts = selected.filter(file => file.startsWith('contracts/') && !file.startsWith('contracts/test/'));
const artifacts = [
  ['AutoMarketImplementation', 'artifacts/contracts/AutoMarket.sol/AutoMarket.json'],
  ['EventMarketImplementation', 'artifacts/contracts/EventMarket.sol/EventMarket.json'],
  ['UniswapTwapResolver', 'artifacts/contracts/resolution/UniswapTwapResolver.sol/UniswapTwapResolver.json'],
  ['MarketFactory', 'artifacts/contracts/MarketFactory.sol/MarketFactory.json']
];
const bytecodeHashes = {};
for (const [name, file] of artifacts) {
  const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
  bytecodeHashes[name] = { creation: keccak256(artifact.bytecode), runtime: keccak256(artifact.deployedBytecode) };
}
const result = {
  format: 'sorted-path-length-content-sha256-v1',
  excluded: [...excludedDirectories, ...excludedFiles],
  releaseFileCount: selected.length,
  releaseSha256: digest(selected),
  productionContractFileCount: productionContracts.length,
  productionContractsSha256: digest(productionContracts),
  productionDeploymentBytecodeKeccak256: bytecodeHashes,
  gitCommit: 'unavailable-no-git-repository'
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/release-hash.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
