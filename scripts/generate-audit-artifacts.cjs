const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { keccak256 } = require('ethers');

const contracts = [
  {
    name: 'AutoMarketImplementation', artifact: 'artifacts/contracts/AutoMarket.sol/AutoMarket.json',
    source: 'contracts/AutoMarket.sol', contractName: 'AutoMarket', category: 'IMPLEMENTATION',
    purpose: 'Locked immutable logic target for all AUTO EIP-1167 clones.',
    immutables: { token: 'canonical USDG', settlement: 'shared OrderBook created by MarketFactory', autoResolver: 'UniswapTwapResolver' }
  },
  {
    name: 'EventMarketImplementation', artifact: 'artifacts/contracts/EventMarket.sol/EventMarket.json',
    source: 'contracts/EventMarket.sol', contractName: 'EventMarket', category: 'IMPLEMENTATION',
    purpose: 'Locked immutable logic target for all EVENT EIP-1167 clones.',
    immutables: { token: 'canonical USDG', settlement: 'shared OrderBook created by MarketFactory', resolverMultisig: 'configured Resolver Safe', proposalBond: '25,000,000 base units (25 USDG)', disputePeriod: '86,400 seconds' }
  },
  {
    name: 'UniswapTwapResolver', artifact: 'artifacts/contracts/resolution/UniswapTwapResolver.sol/UniswapTwapResolver.json',
    source: 'contracts/resolution/UniswapTwapResolver.sol', contractName: 'UniswapTwapResolver', category: 'GLOBAL',
    purpose: 'Historical one-hour WETH/USDG Uniswap V3 arithmetic-mean-tick resolver.',
    immutables: { weth: 'canonical WETH', usdg: 'canonical USDG', pool: 'approved WETH/USDG pool', twapWindow: '3,600 seconds', poolFee: 'read and fixed from pool during construction' }
  },
  {
    name: 'MarketFactory', artifact: 'artifacts/contracts/MarketFactory.sol/MarketFactory.json',
    source: 'contracts/MarketFactory.sol', contractName: 'MarketFactory', category: 'GLOBAL',
    purpose: 'Permissionless registry, listing-fee forwarding, fixed clone creation, and shared component construction.',
    immutables: { token: 'canonical USDG', treasury: 'configured treasury', autoResolver: 'UniswapTwapResolver', resolverMultisig: 'configured Resolver Safe', eventProposalBond: '25,000,000 base units', eventDisputePeriod: '86,400 seconds', autoMarketImplementation: 'locked AutoMarket implementation', eventMarketImplementation: 'locked EventMarket implementation', feeVault: 'created in constructor', orderBook: 'created in constructor' }
  },
  {
    name: 'FeeVault', artifact: 'artifacts/contracts/FeeVault.sol/FeeVault.json',
    source: 'contracts/FeeVault.sol', contractName: 'FeeVault', category: 'GLOBAL_CREATED_BY_FACTORY',
    purpose: 'Creator-fee liability ledger and protocol-fee forwarding endpoint.',
    immutables: { token: 'canonical USDG', treasury: 'configured treasury', factory: 'MarketFactory constructor caller' }
  },
  {
    name: 'OrderBook', artifact: 'artifacts/contracts/OrderBook.sol/OrderBook.json',
    source: 'contracts/OrderBook.sol', contractName: 'OrderBook', category: 'GLOBAL_CREATED_BY_FACTORY',
    purpose: 'Shared order escrow, matching, partial fills, cancellation, and secondary sales.',
    immutables: { token: 'canonical USDG', feeVault: 'FeeVault created by MarketFactory', factory: 'MarketFactory constructor caller' }
  },
  {
    name: 'CollateralVault', artifact: 'artifacts/contracts/CollateralVault.sol/CollateralVault.json',
    source: 'contracts/CollateralVault.sol', contractName: 'CollateralVault', category: 'PER_MARKET',
    purpose: 'Physically isolated collateral backing for one market clone.',
    immutables: { token: 'canonical USDG', market: 'clone that creates the vault during atomic initialization' }
  }
];

function sha256Hex(hex) {
  return `sha256:${crypto.createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex')}`;
}

function buildRecord(definition) {
  const artifact = JSON.parse(fs.readFileSync(definition.artifact, 'utf8'));
  const dbg = JSON.parse(fs.readFileSync(definition.artifact.replace(/\.json$/, '.dbg.json'), 'utf8'));
  const buildInfoPath = path.resolve(path.dirname(definition.artifact), dbg.buildInfo);
  const build = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  const compilerOutput = build.output.contracts[definition.source][definition.contractName];
  const metadata = JSON.parse(compilerOutput.metadata);
  const constructor = artifact.abi.find(item => item.type === 'constructor') || { type: 'constructor', inputs: [], stateMutability: 'nonpayable' };
  return {
    name: definition.name,
    contractName: definition.contractName,
    category: definition.category,
    sourcePath: definition.source,
    purpose: definition.purpose,
    compiler: { version: build.solcVersion, longVersion: build.solcLongVersion },
    compilerInputSettings: build.input.settings,
    effectiveMetadataSettings: { bytecodeHash: metadata.settings.metadata.bytecodeHash, appendCBOR: true, useLiteralContent: false },
    abi: artifact.abi,
    constructorSchema: constructor,
    immutableConfiguration: definition.immutables,
    immutableReferences: compilerOutput.evm.deployedBytecode.immutableReferences || {},
    libraryLinks: {
      creation: artifact.linkReferences || {},
      runtime: artifact.deployedLinkReferences || {}
    },
    creationBytecode: artifact.bytecode,
    creationBytecodeBytes: (artifact.bytecode.length - 2) / 2,
    creationBytecodeSha256: sha256Hex(artifact.bytecode),
    creationBytecodeKeccak256: keccak256(artifact.bytecode),
    runtimeBytecodeTemplate: artifact.deployedBytecode,
    runtimeBytecodeBytes: (artifact.deployedBytecode.length - 2) / 2,
    runtimeBytecodeSha256: sha256Hex(artifact.deployedBytecode),
    runtimeBytecodeKeccak256: keccak256(artifact.deployedBytecode),
    runtimeHashScope: 'Compiler runtime template before constructor immutable substitution'
  };
}

fs.mkdirSync('audit/artifacts', { recursive: true });
const index = {};
for (const definition of contracts) {
  const record = buildRecord(definition);
  const target = `audit/artifacts/${definition.name}.json`;
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  index[definition.name] = {
    sourcePath: record.sourcePath,
    category: record.category,
    creationBytecodeBytes: record.creationBytecodeBytes,
    runtimeBytecodeBytes: record.runtimeBytecodeBytes,
    creationBytecodeSha256: record.creationBytecodeSha256,
    runtimeBytecodeSha256: record.runtimeBytecodeSha256,
    creationBytecodeKeccak256: record.creationBytecodeKeccak256,
    runtimeBytecodeKeccak256: record.runtimeBytecodeKeccak256
  };
}
index.MinimalMarketClone = {
  sourcePath: '@openzeppelin/contracts/proxy/Clones.sol@5.4.0',
  category: 'PER_MARKET',
  creationBytecodeBytes: 55,
  runtimeBytecodeBytes: 45,
  runtimePattern: '0x363d3d373d3d3d363d73<20-byte-implementation>5af43d82803e903d91602b57fd5bf3',
  implementationBinding: 'The 20-byte target is fixed in clone runtime; no storage slot or setter exists.'
};
fs.writeFileSync('audit/artifacts/index.json', `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', artifacts: Object.keys(index) }, null, 2));
