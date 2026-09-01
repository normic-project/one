const fs = require('node:fs');
const crypto = require('node:crypto');

const definitions = [
  ['EventMarketImplementation', 'EventMarket.sol', 'EventMarket'],
  ['MarketFactory', 'MarketFactory.sol', 'MarketFactory'],
  ['OrderBook', 'OrderBook.sol', 'OrderBook'],
  ['FeeVault', 'FeeVault.sol', 'FeeVault'],
  ['CollateralVault', 'CollateralVault.sol', 'CollateralVault']
];
const sha256 = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const index = {};
fs.mkdirSync('audit/artifacts', { recursive: true });
for (const [name, source, contractName] of definitions) {
  const artifact = JSON.parse(fs.readFileSync(`artifacts/contracts/${source}/${contractName}.json`, 'utf8'));
  const creation = Buffer.from(artifact.bytecode.slice(2), 'hex');
  const runtime = Buffer.from(artifact.deployedBytecode.slice(2), 'hex');
  index[name] = {
    source: `contracts/${source}`,
    contractName,
    creationBytes: creation.length,
    runtimeBytes: runtime.length,
    creationBytecodeSha256: sha256(creation),
    runtimeBytecodeSha256: sha256(runtime)
  };
}
fs.writeFileSync('audit/artifacts/index.json', JSON.stringify(index, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', artifacts: Object.keys(index) }, null, 2));
