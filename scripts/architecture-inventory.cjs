const fs = require('node:fs');
const { ethers, artifacts } = require('hardhat');
const { fixture } = require('../test/helpers.cjs');

async function bytes(name) {
  const artifact = await artifacts.readArtifact(name);
  return { creationBytes: (artifact.bytecode.length - 2) / 2,
    runtimeBytes: (artifact.deployedBytecode.length - 2) / 2 };
}

async function deploymentGas(contract) {
  return (await contract.deploymentTransaction().wait()).gasUsed.toString();
}

async function main() {
  const f = await fixture();
  const autoMarketStandalone = await ethers.deployContract('AutoMarket',
    [f.token.target, f.book.target, f.autoResolver.target]);
  const eventMarketStandalone = await ethers.deployContract('EventMarket',
    [f.token.target, f.book.target, f.resolverSigner.address, 25n * 1_000_000n, 86_400]);
  const feeVaultStandalone = await ethers.deployContract('FeeVault', [f.token.target, f.treasury.address]);
  const orderBookStandalone = await ethers.deployContract('OrderBook', [f.token.target, feeVaultStandalone.target]);
  const collateralVaultStandalone = await ethers.deployContract('CollateralVault', [f.token.target]);
  const definitions = {
    AutoMarketImplementation: ['AutoMarket', 'contracts/AutoMarket.sol', autoMarketStandalone,
      'Immutable logic target for every AUTO clone'],
    EventMarketImplementation: ['EventMarket', 'contracts/EventMarket.sol', eventMarketStandalone,
      'Immutable logic target for every EVENT clone'],
    UniswapTwapResolver: ['UniswapTwapResolver', 'contracts/resolution/UniswapTwapResolver.sol', f.autoResolver,
      'Canonical historical WETH/USDG TWAP resolution'],
    MarketFactory: ['MarketFactory', 'contracts/MarketFactory.sol', f.factory,
      'Permissionless creation, registry, listing-fee forwarding and fixed implementation bindings'],
    FeeVault: ['FeeVault', 'contracts/FeeVault.sol', feeVaultStandalone,
      'Creator fee liabilities and protocol-fee forwarding'],
    OrderBook: ['OrderBook', 'contracts/OrderBook.sol', orderBookStandalone,
      'Shared order escrow, matching, cancellation and secondary sales'],
    CollateralVault: ['CollateralVault', 'contracts/CollateralVault.sol', collateralVaultStandalone,
      'Isolated per-market collateral custody']
  };
  const inventory = {};
  for (const [key, [artifact, source, contract, purpose]] of Object.entries(definitions)) {
    inventory[key] = { source, purpose, ...(await bytes(artifact)), standaloneDeploymentGas: await deploymentGas(contract),
      permanentMainnetAddress: key !== 'CollateralVault', globallyDeployedOnce: key !== 'CollateralVault',
      deployedPerMarket: key === 'CollateralVault', storesCreationBytecode: key === 'MarketFactory',
      constructorOnlyLogic: ['AutoMarketImplementation', 'EventMarketImplementation', 'UniswapTwapResolver',
        'MarketFactory', 'FeeVault', 'OrderBook', 'CollateralVault'].includes(key) };
  }
  inventory.MinimalMarketClone = { source: '@openzeppelin/contracts/proxy/Clones.sol',
    purpose: 'Fixed EIP-1167 delegate target for one market', creationBytes: 55, runtimeBytes: 45,
    standaloneDeploymentGas: 'measured as part of create-market transaction', permanentMainnetAddress: true,
    globallyDeployedOnce: false, deployedPerMarket: true, storesCreationBytecode: false, constructorOnlyLogic: false };
  fs.writeFileSync('reports/architecture-final-inventory.json', JSON.stringify(inventory, null, 2) + '\n');
  console.log('Architecture inventory written.');
}

main().catch(error => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
