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
  const eventStandalone = await ethers.deployContract('EventMarket',
    [f.token.target, f.book.target, f.resolverSigner.address]);
  const feeStandalone = await ethers.deployContract('FeeVault', [f.token.target, f.treasury.address]);
  const bookStandalone = await ethers.deployContract('OrderBook', [f.token.target, feeStandalone.target]);
  const collateralStandalone = await ethers.deployContract('CollateralVault', [f.token.target]);
  const definitions = {
    EventMarketImplementation: ['EventMarket', 'contracts/EventMarket.sol', eventStandalone,
      'Immutable logic target for every event-market clone', true, false],
    MarketFactory: ['MarketFactory', 'contracts/MarketFactory.sol', f.factory,
      'Creation, registry, listing-fee forwarding and fixed implementation binding', true, false],
    FeeVault: ['FeeVault', 'contracts/FeeVault.sol', feeStandalone,
      'Creator fee liabilities and protocol-fee forwarding', true, false],
    OrderBook: ['OrderBook', 'contracts/OrderBook.sol', bookStandalone,
      'Shared order escrow, matching, cancellation and secondary sales', true, false],
    CollateralVault: ['CollateralVault', 'contracts/CollateralVault.sol', collateralStandalone,
      'Isolated per-market collateral custody', false, true]
  };
  const inventory = {};
  for (const [key, [artifact, source, contract, purpose, global, perMarket]] of Object.entries(definitions)) {
    inventory[key] = { source, purpose, ...(await bytes(artifact)), standaloneDeploymentGas: await deploymentGas(contract),
      permanentMainnetAddress: true, globallyDeployedOnce: global, deployedPerMarket: perMarket };
  }
  inventory.MinimalMarketClone = { source: '@openzeppelin/contracts/proxy/Clones.sol',
    purpose: 'Fixed EIP-1167 delegate target for one event market', creationBytes: 55, runtimeBytes: 45,
    standaloneDeploymentGas: 'measured as part of create-market transaction', permanentMainnetAddress: true,
    globallyDeployedOnce: false, deployedPerMarket: true };
  const summary = {
    globalPermanentContractCount: 4,
    perMarketContractCount: 2,
    totalProductionRuntimeBytes: Object.keys(definitions)
      .reduce((sum, key) => sum + Number(inventory[key].runtimeBytes), 0)
  };
  fs.writeFileSync('reports/architecture-final-inventory.json', JSON.stringify({ summary, contracts: inventory }, null, 2) + '\n');
  console.log('Architecture inventory written.');
}
main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
