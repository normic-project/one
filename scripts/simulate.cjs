const fs = require('node:fs');
const assert = require('node:assert/strict');
const { ethers, network, artifacts } = require('hardhat');
const { fixture, eventMetadata, UNIT, FEE } = require('../test/helpers.cjs');

async function receiptGas(contract) {
  return (await contract.deploymentTransaction().wait()).gasUsed;
}

async function deployInfrastructure(signer, config) {
  const nonce = await signer.getNonce();
  const factoryAddress = ethers.getCreateAddress({ from: signer.address, nonce: nonce + 1 });
  const orderBookAddress = ethers.getCreateAddress({ from: factoryAddress, nonce: 2 });
  const eventMarketImplementation = await ethers.deployContract('EventMarket',
    [config.usdg, orderBookAddress, config.resolverMultisig], signer);
  const factory = await ethers.deployContract('MarketFactory', [config.usdg, config.treasury,
    config.resolverMultisig, eventMarketImplementation.target], signer);
  assert.equal(factory.target.toLowerCase(), factoryAddress.toLowerCase());
  assert.equal((await factory.orderBook()).toLowerCase(), orderBookAddress.toLowerCase());
  return { eventMarketImplementation, factory, gas: {
    eventMarketImplementation: await receiptGas(eventMarketImplementation),
    factory: await receiptGas(factory)
  } };
}

async function placePair(book, market, yesBuyer, noBuyer, shares = 10n, yesPrice = 60) {
  const close = await market.closesAt();
  const yesId = await book.nextOrderId();
  const yesTx = await book.connect(yesBuyer).placeOrder({ market: market.target, expiresAt: close,
    price: yesPrice, yes: true, buy: true, shares });
  const yesReceipt = await yesTx.wait();
  const noId = await book.nextOrderId();
  await book.connect(noBuyer).placeOrder({ market: market.target, expiresAt: close,
    price: 100 - yesPrice, yes: false, buy: true, shares });
  const matchTx = await book.matchOrders(yesId, noId, shares);
  return { yesReceipt, receipt: await matchTx.wait() };
}

async function runtimeSizes(gas) {
  const names = ['MarketFactory', 'OrderBook', 'PredictionMarket', 'EventMarket', 'FeeVault', 'CollateralVault'];
  let total = 0;
  for (const name of names) {
    const artifact = await artifacts.readArtifact(name);
    const size = (artifact.deployedBytecode.length - 2) / 2;
    assert.ok(size <= 24576, `${name} exceeds EIP-170 runtime size`);
    gas[`${name}RuntimeBytes`] = size;
    total += size;
  }
  gas.totalRuntimeBytes = total;
}

async function localSimulation() {
  const f = await fixture();
  const gas = {
    eventMarketImplementation: await receiptGas(f.eventMarketImplementation),
    factory: await receiptGas(f.factory)
  };
  gas.totalDeployment = gas.eventMarketImplementation + gas.factory;
  const created = await f.createEvent();
  const createFilter = f.factory.filters.MarketCreated(created.market.target);
  const createLog = (await f.factory.queryFilter(createFilter))[0];
  gas.createEventMarket = (await ethers.provider.getTransactionReceipt(createLog.transactionHash)).gasUsed;
  const yesOrderId = await f.place(f.alice, true, true, 60, 1000n);
  const noOrderId = await f.place(f.bob, false, true, 40, 1000n);
  gas.primaryMatch = await f.book.matchOrders.estimateGas(yesOrderId, noOrderId, 1000n);
  await f.book.matchOrders(yesOrderId, noOrderId, 1000n);
  assert.equal(await f.collateral.locked(), 1000n * UNIT);
  assert.equal(await f.feeVault.claimable(f.creator), 6n * UNIT);
  const sell = await f.place(f.alice, true, false, 70, 10);
  gas.cancelOrder = await f.book.connect(f.alice).cancelOrder.estimateGas(sell);
  await f.book.connect(f.alice).cancelOrder(sell);
  await network.provider.send('evm_setNextBlockTimestamp', [f.eventTimes.resolvesAt]);
  gas.eventResolve = await f.market.connect(f.resolverSigner).resolve.estimateGas(1);
  await f.market.connect(f.resolverSigner).resolve(1);
  gas.redeem = await f.market.connect(f.alice).redeem.estimateGas(true, 1000);
  await f.market.connect(f.alice).redeem(true, 1000);
  assert.equal(await f.collateral.locked(), 0n);
  await runtimeSizes(gas);
  return gas;
}

async function findUSDGHolder(token, minimum, forkBlock) {
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  for (let end = forkBlock; end > forkBlock - 5_000; end -= 10) {
    const from = Math.max(0, end - 9);
    const logs = await ethers.provider.getLogs({ address: token.target, fromBlock: from, toBlock: end, topics: [transferTopic] });
    for (let i = logs.length - 1; i >= 0; --i) {
      if (logs[i].topics.length < 3) continue;
      const candidate = ethers.getAddress(`0x${logs[i].topics[2].slice(26)}`);
      if (candidate === ethers.ZeroAddress || await ethers.provider.getCode(candidate) !== '0x') continue;
      if (await token.balanceOf(candidate) >= minimum) return candidate;
    }
  }
  throw new Error('Could not find an EOA with enough USDG in the pinned fork history.');
}

async function forkSimulation() {
  const { settings, address } = require('./validate.cjs');
  const canonical = settings(process.env, true);
  const treasury = address(process.env.TREASURY_ADDRESS, 'TREASURY_ADDRESS');
  const deployerAddress = address(process.env.DEPLOYER_ADDRESS, 'DEPLOYER_ADDRESS');
  const resolverAddress = address(process.env.RESOLVER_MULTISIG_ADDRESS, 'RESOLVER_MULTISIG_ADDRESS');
  await network.provider.send('evm_mine');
  await network.provider.send('hardhat_impersonateAccount', [deployerAddress]);
  await network.provider.send('hardhat_setBalance', [deployerAddress, '0x56BC75E2D63100000']);
  await network.provider.send('hardhat_impersonateAccount', [resolverAddress]);
  await network.provider.send('hardhat_setBalance', [resolverAddress, '0xDE0B6B3A7640000']);
  assert.notEqual(await ethers.provider.getCode(resolverAddress), '0x', 'Configured resolver has no code at the fork block.');
  const deployer = await ethers.getSigner(deployerAddress);
  const resolverSigner = await ethers.getSigner(resolverAddress);
  const deployed = await deployInfrastructure(deployer, { ...canonical, treasury, resolverMultisig: resolverAddress });
  const gas = { ...deployed.gas };
  gas.totalDeployment = gas.eventMarketImplementation + gas.factory;
  const factory = deployed.factory;
  const book = await ethers.getContractAt('OrderBook', await factory.orderBook());
  const feeVault = await ethers.getContractAt('FeeVault', await factory.feeVault());
  const token = await ethers.getContractAt('MockUSDG', canonical.usdg);
  assert.equal(await token.decimals(), 6n);
  assert.equal(await factory.token(), canonical.usdg);
  assert.equal(await factory.treasury(), treasury);
  assert.equal(await factory.resolverMultisig(), resolverAddress);
  assert.equal(await factory.eventMarketImplementation(), deployed.eventMarketImplementation.target);
  assert.equal(await deployed.eventMarketImplementation.token(), canonical.usdg);
  assert.equal(await deployed.eventMarketImplementation.settlement(), book.target);
  assert.equal(await deployed.eventMarketImplementation.resolverMultisig(), resolverAddress);
  assert.equal(await book.factory(), factory.target);
  assert.equal(await book.token(), canonical.usdg);
  assert.equal(await feeVault.treasury(), treasury);

  const actors = (await ethers.getSigners()).slice(1, 7);
  const holder = await findUSDGHolder(token, 2_000n * UNIT, Number(process.env.FORK_BLOCK));
  await network.provider.send('hardhat_impersonateAccount', [holder]);
  await network.provider.send('hardhat_setBalance', [holder, '0xDE0B6B3A7640000']);
  const holderSigner = await ethers.getSigner(holder);
  for (const actor of actors) {
    await token.connect(holderSigner).transfer(actor.address, 250n * UNIT);
    await token.connect(actor).approve(book.target, ethers.MaxUint256);
  }

  const now = (await ethers.provider.getBlock('latest')).timestamp;
  const closesAt = now + 120;
  const resolvesAt = now + 180;
  const markets = [];
  for (const [name, category] of [['YES', 'Politics'], ['NO', 'Sports'], ['INVALID', 'Other']]) {
    const tx = await factory.connect(actors[0]).createEventMarket(closesAt, resolvesAt, eventMetadata({
      question: `Will the fork lifecycle ${name} event occur?`, category,
      primarySource: `https://example.com/${name.toLowerCase()}`
    }), { value: FEE });
    const receipt = await tx.wait();
    if (!gas.createEventMarket) gas.createEventMarket = receipt.gasUsed;
    const market = await ethers.getContractAt('EventMarket', await factory.markets((await factory.marketCount()) - 1n));
    const cloneCode = (await ethers.provider.getCode(market.target)).toLowerCase();
    assert.equal((cloneCode.length - 2) / 2, 45);
    assert.ok(cloneCode.includes(deployed.eventMarketImplementation.target.toLowerCase().slice(2)));
    markets.push(market);
  }
  for (const market of markets) {
    const matched = await placePair(book, market, actors[1], actors[2], 10n);
    if (!gas.primaryMatch) {
      gas.placeBuyOrder = matched.yesReceipt.gasUsed;
      gas.primaryMatch = matched.receipt.gasUsed;
    }
  }
  const sellId = await book.nextOrderId();
  await book.connect(actors[1]).placeOrder({ market: markets[0].target, expiresAt: closesAt,
    price: 70, yes: true, buy: false, shares: 2 });
  const buyId = await book.nextOrderId();
  await book.connect(actors[3]).placeOrder({ market: markets[0].target, expiresAt: closesAt,
    price: 70, yes: true, buy: true, shares: 2 });
  gas.secondaryMatch = (await (await book.matchOrders(sellId, buyId, 2)).wait()).gasUsed;
  const cancelId = await book.nextOrderId();
  gas.placeUnmatchedOrder = (await (await book.connect(actors[3]).placeOrder({ market: markets[0].target,
    expiresAt: closesAt, price: 55, yes: false, buy: true, shares: 1 })).wait()).gasUsed;
  gas.cancelOrder = (await (await book.connect(actors[3]).cancelOrder(cancelId)).wait()).gasUsed;
  assert.equal(await book.escrowedUSDG(), 0n);
  assert.ok(await feeVault.totalClaimable() > 0n);

  await network.provider.send('evm_setNextBlockTimestamp', [resolvesAt]);
  await network.provider.send('evm_mine');
  gas.eventResolve = (await (await markets[0].connect(resolverSigner).resolve(1)).wait()).gasUsed;
  await markets[1].connect(resolverSigner).resolve(2);
  await markets[2].connect(resolverSigner).resolve(3);
  gas.redeem = (await (await markets[0].connect(actors[1]).redeem(true, 8)).wait()).gasUsed;
  await markets[0].connect(actors[3]).redeem(true, 2);
  await markets[1].connect(actors[2]).redeem(false, 10);
  await markets[2].connect(actors[1]).redeem(true, 10);
  await markets[2].connect(actors[2]).redeem(false, 10);
  for (const market of markets) {
    const vault = await ethers.getContractAt('CollateralVault', await market.collateralVault());
    assert.equal(await vault.locked(), 0n);
    assert.equal(await token.balanceOf(market.target), 0n);
  }
  assert.equal(await book.escrowedUSDG(), 0n);
  assert.equal(await token.balanceOf(book), 0n);
  assert.equal(await token.balanceOf(await factory.feeVault()), await feeVault.totalClaimable());
  await runtimeSizes(gas);
  return { gas, resolverMode: 'configured-mainnet-resolver-impersonated', usdGHolderImpersonated: true,
    lifecycle: { eventYes: 'PASS', eventNo: 'PASS', eventInvalid: 'PASS' } };
}

async function simulate() {
  const fork = process.env.SIMULATE_FORK === '1';
  const data = fork ? await forkSimulation() : { gas: await localSimulation() };
  fs.mkdirSync('reports', { recursive: true });
  const file = fork ? 'reports/mainnet-simulation.json' : 'reports/local-simulation.json';
  fs.writeFileSync(file, JSON.stringify({ mode: fork ? 'pinned-mainnet-fork' : 'in-memory-unit-simulation',
    chainId: 4663, forkBlock: process.env.FORK_BLOCK || null, ...data, broadcast: false },
  (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  console.log(`Simulation succeeded; no network transactions broadcast. Gas report: ${file}`);
}

simulate().catch(error => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
