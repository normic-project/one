require('dotenv').config();

const fs = require('node:fs');
const { JsonRpcProvider, Contract, getAddress, keccak256, toQuantity } = require('ethers');
const canonical = require('../config/mainnet.json');
const SAFE_L2_141_RUNTIME_HASH = '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff';
const SAFE_SENTINEL_MODULES = '0x0000000000000000000000000000000000000001';
const SAFE_GUARD_STORAGE_SLOT = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8';

function address(value, label) {
  let result;
  try { result = getAddress(value || ''); } catch { throw new Error(`${label} must be a valid checksummed EVM address.`); }
  if (BigInt(result) <= 0xffffn || result.toLowerCase() === '0x000000000000000000000000000000000000dead')
    throw new Error(`${label} must not be zero, a precompile, or a burn address.`);
  return result;
}

function settings(env = process.env, networkOnly = false) {
  if (String(env.RH_CHAIN_ID || canonical.chainId) !== '4663')
    throw new Error('Only Robinhood Chain MAINNET chain ID 4663 is allowed.');
  const rpc = env.RH_RPC_URL || canonical.rpcUrl;
  const url = new URL(rpc);
  if (url.protocol !== 'https:' || /testnet|sepolia|localhost|127\.0\.0\.1/i.test(url.href))
    throw new Error('Deployment requires an HTTPS mainnet RPC, never a testnet or local node.');
  const usdg = address(env.USDG_ADDRESS || canonical.usdg, 'USDG_ADDRESS');
  if (usdg !== getAddress(canonical.usdg))
    throw new Error('USDG_ADDRESS does not match the official Robinhood mainnet USDG address.');
  const base = { rpc, usdg };
  if (networkOnly) return base;

  const treasury = address(env.TREASURY_ADDRESS, 'TREASURY_ADDRESS');
  const deployer = address(env.DEPLOYER_ADDRESS, 'DEPLOYER_ADDRESS');
  const resolverMultisig = address(env.RESOLVER_MULTISIG_ADDRESS, 'RESOLVER_MULTISIG_ADDRESS');
  if (new Set([treasury, deployer, resolverMultisig, usdg].map(v => v.toLowerCase())).size !== 4)
    throw new Error('Treasury, deployer, resolver multisig and USDG must all be distinct.');
  return { ...base, treasury, deployer, resolverMultisig };
}

async function validate(networkOnly = false) {
  const config = settings(process.env, networkOnly);
  const provider = new JsonRpcProvider(config.rpc, 4663, { batchMaxCount: 1, staticNetwork: true });
  const chain = await provider.send('eth_chainId', []);
  if (BigInt(chain) !== 4663n) throw new Error(`RPC chain ID mismatch: ${BigInt(chain)}. Expected 4663.`);
  const [usdgCode, block, pinnedBlock, pinnedUsdgCode] = await Promise.all([
    provider.getCode(config.usdg), provider.getBlock('latest'), provider.getBlock(canonical.forkBlock),
    provider.getCode(config.usdg, canonical.forkBlock)
  ]);
  if ([usdgCode, pinnedUsdgCode].some(code => !code || code === '0x'))
    throw new Error('Canonical USDG has no bytecode at the current or pinned archive block.');
  if (!block || !pinnedBlock || Math.abs(Date.now() / 1000 - block.timestamp) > 300)
    throw new Error('RPC head is stale or the pinned archive block is unavailable.');
  if (block.gasLimit < 5_000_000n) throw new Error('Robinhood mainnet block gas limit is too low for the deployment plan.');

  const token = new Contract(config.usdg, [
    'function decimals() view returns(uint8)', 'function symbol() view returns(string)',
    'function totalSupply() view returns(uint256)'
  ], provider);
  const [decimals, symbol, supply] = await Promise.all([token.decimals(), token.symbol(), token.totalSupply()]);
  if (decimals !== 6n || symbol !== 'USDG' || supply <= 0n)
    throw new Error('USDG metadata or supply validation failed.');

  const result = {
    chainId: 4663,
    block: block.number,
    blockHash: block.hash,
    blockGasLimit: block.gasLimit.toString(),
    pinnedForkBlock: pinnedBlock.number,
    pinnedForkBlockHash: pinnedBlock.hash,
    usdg: config.usdg,
    usdgCodeHash: keccak256(usdgCode),
    archiveAccess: true,
    timestamp: new Date().toISOString()
  };

  if (!networkOnly) {
    const [deployerCode, resolverCode, treasuryCode, singletonStorage, guardStorage] = await Promise.all([
      provider.getCode(config.deployer), provider.getCode(config.resolverMultisig), provider.getCode(config.treasury),
      provider.getStorage(config.resolverMultisig, 0), provider.getStorage(config.resolverMultisig, SAFE_GUARD_STORAGE_SLOT)
    ]);
    if (deployerCode !== '0x') throw new Error('DEPLOYER_ADDRESS must be an EOA.');
    if (resolverCode === '0x') throw new Error('RESOLVER_MULTISIG_ADDRESS must be a deployed Safe or equivalent contract.');
    if (BigInt(singletonStorage) === 0n) throw new Error('RESOLVER_MULTISIG_ADDRESS is not a Safe proxy with a singleton.');
    const singleton = getAddress(`0x${singletonStorage.slice(-40)}`);
    const singletonCode = await provider.getCode(singleton);
    if (singletonCode === '0x' || keccak256(singletonCode) !== SAFE_L2_141_RUNTIME_HASH)
      throw new Error('Resolver singleton bytecode is not the official SafeL2 v1.4.1 runtime.');
    const safe = new Contract(config.resolverMultisig, [
      'function VERSION() view returns(string)', 'function getOwners() view returns(address[])',
      'function getThreshold() view returns(uint256)', 'function nonce() view returns(uint256)',
      'function domainSeparator() view returns(bytes32)',
      'function getModulesPaginated(address,uint256) view returns(address[],address)'
    ], provider);
    const [safeVersion, owners, safeThreshold, safeNonce, safeDomain, modulePage] = await Promise.all([
      safe.VERSION(), safe.getOwners(), safe.getThreshold(), safe.nonce(), safe.domainSeparator(),
      safe.getModulesPaginated(SAFE_SENTINEL_MODULES, 100)
    ]);
    const normalizedOwners = owners.map(owner => address(owner, 'Safe owner').toLowerCase());
    if (safeVersion !== '1.4.1' || normalizedOwners.length !== 5 || new Set(normalizedOwners).size !== 5 ||
        safeThreshold !== 3n || normalizedOwners.includes(config.resolverMultisig.toLowerCase()) ||
        modulePage[0].length !== 0 || BigInt(guardStorage) !== 0n || /^0x0+$/.test(safeDomain))
      throw new Error('Resolver must be an unguarded, module-free, official Safe v1.4.1 with exactly five unique owners and threshold three.');
    const listingFee = 600000000000000n;
    await provider.send('eth_call', [{ from: config.deployer, to: config.treasury,
      value: toQuantity(listingFee) }, 'latest', { [config.deployer]: { balance: toQuantity(listingFee * 2n) } }]);
    Object.assign(result, {
      treasury: config.treasury,
      deployer: config.deployer,
      resolverMultisig: config.resolverMultisig,
      resolverMultisigCodeHash: keccak256(resolverCode),
      resolverSingletonCodeHash: keccak256(singletonCode),
      resolverSafeVersion: safeVersion,
      resolverSafeOwnerCount: owners.length,
      resolverSafeThreshold: Number(safeThreshold),
      resolverSafeNonce: safeNonce.toString(),
      resolverSafeEnabledModuleCount: modulePage[0].length,
      resolverSafeGuardConfigured: false,
      treasuryCodeHash: treasuryCode === '0x' ? null : keccak256(treasuryCode)
    });
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/mainnet-validation.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  return { config, provider, result };
}

module.exports = { settings, validate, address };
if (require.main === module) validate(process.argv.includes('--network-only')).catch(error => {
  console.error(`Validation failed: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
