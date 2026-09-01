const fs = require('node:fs');
const assert = require('node:assert/strict');
const { ethers, network, artifacts } = require('hardhat');
const { fixture, eventMetadata, UNIT, FEE, BOND, DISPUTE_PERIOD } = require('../test/helpers.cjs');

async function receiptGas(contract) {
  return (await contract.deploymentTransaction().wait()).gasUsed;
}

async function deployInfrastructure(signer, config) {
  const nonce = await signer.getNonce();
  const factoryAddress = ethers.getCreateAddress({ from: signer.address, nonce: nonce + 3 });
  const orderBookAddress = ethers.getCreateAddress({ from: factoryAddress, nonce: 2 });
  const autoResolver = await ethers.deployContract('UniswapTwapResolver',
    [config.weth, config.usdg, config.pool, config.twapWindow], signer);
  const autoMarketImplementation = await ethers.deployContract('AutoMarket',
    [config.usdg, orderBookAddress, autoResolver.target], signer);
  const eventMarketImplementation = await ethers.deployContract('EventMarket',
    [config.usdg, orderBookAddress, config.resolverMultisig, config.eventProposalBond,
      config.eventDisputePeriod], signer);
  const factory = await ethers.deployContract('MarketFactory', [config.usdg, config.treasury, autoResolver.target,
    config.resolverMultisig, config.eventProposalBond, config.eventDisputePeriod,
    autoMarketImplementation.target, eventMarketImplementation.target], signer);
  assert.equal(factory.target.toLowerCase(), factoryAddress.toLowerCase());
  assert.equal((await factory.orderBook()).toLowerCase(), orderBookAddress.toLowerCase());
  return { autoMarketImplementation, eventMarketImplementation, autoResolver, factory,
    gas: {
      autoMarketImplementation: await receiptGas(autoMarketImplementation),
      eventMarketImplementation: await receiptGas(eventMarketImplementation),
      autoResolver: await receiptGas(autoResolver),
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
  const noTx = await book.connect(noBuyer).placeOrder({ market: market.target, expiresAt: close,
    price: 100 - yesPrice, yes: false, buy: true, shares });
  const noReceipt = await noTx.wait();
  const matchTx = await book.matchOrders(yesId, noId, shares);
  return { yesId, noId, yesReceipt, noReceipt, receipt: await matchTx.wait() };
}

async function runtimeSizes(gas) {
  const names = [
    ['MarketFactory', 'MarketFactory'], ['OrderBook', 'OrderBook'], ['PredictionMarket', 'PredictionMarket'],
    ['AutoMarket', 'AutoMarket'], ['EventMarket', 'EventMarket'], ['FeeVault', 'FeeVault'],
    ['CollateralVault', 'CollateralVault'], ['UniswapTwapResolver', 'UniswapTwapResolver']
  ];
  for (const [key, artifactName] of names) {
    const artifact = await artifacts.readArtifact(artifactName);
    const size = (artifact.deployedBytecode.length - 2) / 2;
    assert.ok(size <= 24576, `${artifactName} exceeds EIP-170 runtime size`);
    gas[`${key}RuntimeBytes`] = size;
  }
}

async function localSimulation() {
  const f = await fixture();
  const gas = {
    autoMarketImplementation: await receiptGas(f.autoMarketImplementation),
    eventMarketImplementation: await receiptGas(f.eventMarketImplementation),
    autoResolver: await receiptGas(f.autoResolver),
    factory: await receiptGas(f.factory)
  };
  gas.totalDeployment = gas.autoMarketImplementation + gas.eventMarketImplementation + gas.autoResolver + gas.factory;
  const yesOrderId = await f.place(f.alice, true, true, 60, 1000n);
  const noOrderId = await f.place(f.bob, false, true, 40, 1000n);
  gas.primaryMatch = await f.book.matchOrders.estimateGas(yesOrderId, noOrderId, 1000n);
  await f.book.matchOrders(yesOrderId, noOrderId, 1000n);
  assert.equal(await f.collateral.locked(), 1000n * UNIT);
  assert.equal(await f.feeVault.claimable(f.creator), 6n * UNIT);
  const sell = await f.place(f.alice, true, false, 70, 10);
  gas.cancel = await f.book.connect(f.alice).cancelOrder.estimateGas(sell);
  await f.book.connect(f.alice).cancelOrder(sell);
  await network.provider.send('evm_setNextBlockTimestamp', [f.eventTimes.resolvesAt]);
  await f.market.connect(f.carol).propose(1, 'ipfs://local-undisputed');
  await network.provider.send('evm_increaseTime', [DISPUTE_PERIOD]);
  await network.provider.send('evm_mine');
  gas.eventFinalize = await f.market.finalize.estimateGas();
  await f.market.finalize();
  gas.redeem = await f.market.connect(f.alice).redeem.estimateGas(true, 1000);
  await f.market.connect(f.alice).redeem(true, 1000);
  assert.equal(await f.collateral.locked(), 0n);
  await runtimeSizes(gas);
  return gas;
}

async function findUSDGHolder(token, minimum, forkBlock) {
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  // The managed Robinhood RPC caps eth_getLogs to ten blocks per request.
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
  await network.provider.send('evm_mine');
  await network.provider.send('hardhat_impersonateAccount', [deployerAddress]);
  await network.provider.send('hardhat_setBalance', [deployerAddress, '0x56BC75E2D63100000']);
  const deployer = await ethers.getSigner(deployerAddress);
  const localSigners = await ethers.getSigners();
  const configuredResolver = process.env.RESOLVER_MULTISIG_ADDRESS
    ? address(process.env.RESOLVER_MULTISIG_ADDRESS, 'RESOLVER_MULTISIG_ADDRESS') : null;
  const resolverAddress = configuredResolver || localSigners[9].address;
  if (configuredResolver) {
    assert.notEqual(await ethers.provider.getCode(resolverAddress), '0x',
      'Configured resolver multisig has no code at the pinned fork block.');
    await network.provider.send('hardhat_impersonateAccount', [resolverAddress]);
    await network.provider.send('hardhat_setBalance', [resolverAddress, '0xDE0B6B3A7640000']);
  }
  const resolverSigner = configuredResolver ? await ethers.getSigner(resolverAddress) : localSigners[9];
  const config = { ...canonical, treasury, resolverMultisig: resolverSigner.address,
    eventProposalBond: BOND, eventDisputePeriod: DISPUTE_PERIOD };
  const deployed = await deployInfrastructure(deployer, config);
  const gas = { ...deployed.gas };
  gas.totalDeployment = gas.autoMarketImplementation + gas.eventMarketImplementation + gas.autoResolver + gas.factory;
  const factory = deployed.factory;
  const book = await ethers.getContractAt('OrderBook', await factory.orderBook());
  const feeVault = await ethers.getContractAt('FeeVault', await factory.feeVault());
  const token = await ethers.getContractAt('MockUSDG', canonical.usdg);
  assert.equal(await token.decimals(), 6n);
  assert.equal(await factory.token(), canonical.usdg);
  assert.equal(await factory.treasury(), treasury);
  assert.equal(await factory.resolverMultisig(), resolverSigner.address);
  assert.equal(await factory.eventProposalBond(), BOND);
  assert.equal(await factory.eventDisputePeriod(), BigInt(DISPUTE_PERIOD));
  assert.equal(await factory.autoMarketImplementation(), deployed.autoMarketImplementation.target);
  assert.equal(await factory.eventMarketImplementation(), deployed.eventMarketImplementation.target);
  assert.equal(await deployed.autoMarketImplementation.token(), canonical.usdg);
  assert.equal(await deployed.autoMarketImplementation.settlement(), book.target);
  assert.equal(await deployed.autoMarketImplementation.autoResolver(), deployed.autoResolver.target);
  assert.equal(await deployed.eventMarketImplementation.token(), canonical.usdg);
  assert.equal(await deployed.eventMarketImplementation.settlement(), book.target);
  assert.equal(await deployed.eventMarketImplementation.resolverMultisig(), resolverSigner.address);
  assert.equal(await deployed.eventMarketImplementation.proposalBond(), BOND);
  assert.equal(await deployed.eventMarketImplementation.disputePeriod(), BigInt(DISPUTE_PERIOD));
  assert.equal(await deployed.autoResolver.weth(), canonical.weth);
  assert.equal(await deployed.autoResolver.usdg(), canonical.usdg);
  assert.equal(await deployed.autoResolver.pool(), canonical.pool);
  assert.equal(await deployed.autoResolver.twapWindow(), BigInt(canonical.twapWindow));
  assert.equal(await book.factory(), factory.target);
  assert.equal(await book.token(), canonical.usdg);
  assert.equal(await feeVault.treasury(), treasury);
  assert.equal(await feeVault.token(), canonical.usdg);

  const actors = localSigners.slice(1, 7);
  const needed = 2_000n * UNIT;
  const holder = await findUSDGHolder(token, needed, Number(process.env.FORK_BLOCK));
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
  const currentPrice = await deployed.autoResolver.priceAt(now);
  const threshold = currentPrice / UNIT * UNIT;
  const autoTx = await factory.connect(actors[0]).createAutoMarket({ threshold, closesAt, resolvesAt, condition: 0 }, { value: FEE });
  gas.createAutoMarket = (await autoTx.wait()).gasUsed;
  const autoMarket = await ethers.getContractAt('AutoMarket', await factory.markets(0));
  const autoCloneCode = (await ethers.provider.getCode(autoMarket.target)).toLowerCase();
  assert.equal((autoCloneCode.length - 2) / 2, 45);
  assert.ok(autoCloneCode.includes(deployed.autoMarketImplementation.target.toLowerCase().slice(2)));

  const eventMarkets = [];
  for (const [name, category] of [['Undisputed', 'Politics'], ['Disputed', 'Sports'], ['Invalid', 'Other']]) {
    const tx = await factory.connect(actors[0]).createEventMarket(closesAt, resolvesAt, eventMetadata({
      question: `Will the fork lifecycle ${name} event occur?`, category,
      primarySource: `https://example.com/${name.toLowerCase()}`
    }), { value: FEE });
    const receipt = await tx.wait();
    if (!gas.createEventMarket) gas.createEventMarket = receipt.gasUsed;
    const market = await ethers.getContractAt('EventMarket', await factory.markets((await factory.marketCount()) - 1n));
    const eventCloneCode = (await ethers.provider.getCode(market.target)).toLowerCase();
    assert.equal((eventCloneCode.length - 2) / 2, 45);
    assert.ok(eventCloneCode.includes(deployed.eventMarketImplementation.target.toLowerCase().slice(2)));
    eventMarkets.push(market);
    for (const actor of actors) await token.connect(actor).approve(market.target, ethers.MaxUint256);
  }

  const markets = [autoMarket, ...eventMarkets];
  for (const market of markets) {
    const matched = await placePair(book, market, actors[1], actors[2], 10n);
    if (!gas.primaryMatch) {
      gas.placeBuyOrder = matched.yesReceipt.gasUsed;
      gas.primaryMatch = matched.receipt.gasUsed;
    }
  }
  const sellId = await book.nextOrderId();
  await book.connect(actors[1]).placeOrder({ market: autoMarket.target, expiresAt: closesAt,
    price: 70, yes: true, buy: false, shares: 2 });
  const buyId = await book.nextOrderId();
  await book.connect(actors[3]).placeOrder({ market: autoMarket.target, expiresAt: closesAt,
    price: 70, yes: true, buy: true, shares: 2 });
  gas.secondaryMatch = (await (await book.matchOrders(sellId, buyId, 2)).wait()).gasUsed;
  const cancelId = await book.nextOrderId();
  const cancelPlace = await book.connect(actors[3]).placeOrder({ market: autoMarket.target, expiresAt: closesAt,
    price: 55, yes: false, buy: true, shares: 1 });
  gas.placeUnmatchedOrder = (await cancelPlace.wait()).gasUsed;
  gas.cancelOrder = (await (await book.connect(actors[3]).cancelOrder(cancelId)).wait()).gasUsed;
  assert.equal(await (await ethers.getContractAt('CollateralVault', await autoMarket.collateralVault())).locked(), 10n * UNIT);
  assert.equal(await book.escrowedUSDG(), 0n);
  assert.ok(await feeVault.totalClaimable() > 0n);

  await network.provider.send('evm_setNextBlockTimestamp', [resolvesAt + 420]);
  await network.provider.send('evm_mine');
  gas.autoResolve = (await (await autoMarket.connect(actors[4]).resolve()).wait()).gasUsed;
  const [undisputed, disputed, invalid] = eventMarkets;
  gas.eventPropose = (await (await undisputed.connect(actors[3]).propose(1, 'ipfs://fork-undisputed')).wait()).gasUsed;
  await disputed.connect(actors[3]).propose(1, 'ipfs://fork-proposal-yes');
  gas.eventDispute = (await (await disputed.connect(actors[4]).dispute(2, 'ipfs://fork-dispute-no')).wait()).gasUsed;
  await invalid.connect(actors[3]).propose(1, 'ipfs://fork-proposal-yes');
  await invalid.connect(actors[4]).dispute(2, 'ipfs://fork-dispute-no');
  gas.eventAdjudicate = (await (await disputed.connect(resolverSigner).adjudicate(2)).wait()).gasUsed;
  await invalid.connect(resolverSigner).adjudicate(3);
  await network.provider.send('evm_increaseTime', [DISPUTE_PERIOD]);
  await network.provider.send('evm_mine');
  gas.eventFinalize = (await (await undisputed.connect(actors[5]).finalize()).wait()).gasUsed;

  const autoOutcome = Number(await autoMarket.resolvedOutcome());
  if (autoOutcome === 1) {
    await autoMarket.connect(actors[1]).redeem(true, 8);
    await autoMarket.connect(actors[3]).redeem(true, 2);
  } else await autoMarket.connect(actors[2]).redeem(false, 10);
  gas.redeem = (await (await undisputed.connect(actors[1]).redeem(true, 10)).wait()).gasUsed;
  await disputed.connect(actors[2]).redeem(false, 10);
  await invalid.connect(actors[1]).redeem(true, 10);
  await invalid.connect(actors[2]).redeem(false, 10);
  for (const market of markets) {
    const vault = await ethers.getContractAt('CollateralVault', await market.collateralVault());
    assert.equal(await vault.locked(), 0n);
  }
  for (const market of eventMarkets) {
    assert.equal(await market.bondEscrowed(), 0n);
    assert.equal(await token.balanceOf(market.target), 0n);
  }
  assert.equal(await book.escrowedUSDG(), 0n);
  assert.equal(await token.balanceOf(book), 0n);
  assert.equal(await token.balanceOf(await factory.feeVault()), await feeVault.totalClaimable());
  await runtimeSizes(gas);
  return { gas, resolverMode: configuredResolver ? 'configured-mainnet-resolver-impersonated' : 'controlled-fork-test-address',
    usdGHolderImpersonated: true,
    lifecycle: { auto: 'PASS', eventUndisputed: 'PASS', eventDisputed: 'PASS', eventInvalid: 'PASS' } };
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
