const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { fixture, eventMetadata, deployMarketImplementations, UNIT, FEE, BOND, DISPUTE_PERIOD } = require('./helpers.cjs');

describe('Factory, market types and immutable metadata', function () {
  it('locks implementations and initializes each fixed-implementation clone exactly once', async () => {
    const f = await loadFixture(fixture);
    const latest = await time.latest();
    const terms = { threshold: 3000n * UNIT, closesAt: latest + 3600, resolvesAt: latest + 3700, condition: 0 };
    await expect(f.autoMarketImplementation.initialize(f.creator.address, terms))
      .to.be.revertedWithCustomError(f.autoMarketImplementation, 'AlreadyInitialized');
    await expect(f.market.initialize(f.creator.address, latest + 3600, latest + 3700, eventMetadata()))
      .to.be.revertedWithCustomError(f.market, 'AlreadyInitialized');
    const cloneCode = (await ethers.provider.getCode(f.market.target)).toLowerCase();
    expect((cloneCode.length - 2) / 2).to.equal(45);
    expect(cloneCode).to.include(f.eventMarketImplementation.target.toLowerCase().slice(2));
    expect(await f.autoMarketImplementation.token()).to.equal(f.token.target);
    expect(await f.autoMarketImplementation.settlement()).to.equal(f.book.target);
    expect(await f.autoMarketImplementation.autoResolver()).to.equal(f.autoResolver.target);
    expect(await f.eventMarketImplementation.token()).to.equal(f.token.target);
    expect(await f.eventMarketImplementation.settlement()).to.equal(f.book.target);
    expect(await f.eventMarketImplementation.resolverMultisig()).to.equal(f.resolverSigner.address);
    expect(await f.eventMarketImplementation.proposalBond()).to.equal(BOND);
    expect(await f.eventMarketImplementation.disputePeriod()).to.equal(DISPUTE_PERIOD);
    for (const name of ['setAutoMarketImplementation', 'setEventMarketImplementation', 'upgradeTo', 'upgradeToAndCall'])
      expect(f.factory.interface.hasFunction(name)).to.equal(false);
  });

  it('creates both market types and forwards every listing fee without liquidity', async () => {
    const f = await loadFixture(fixture);
    const treasuryBefore = await ethers.provider.getBalance(f.treasury);
    const auto = await f.createAuto();
    expect(await auto.market.marketType()).to.equal(0);
    expect(await f.market.marketType()).to.equal(1);
    expect(await ethers.provider.getBalance(f.treasury)).to.equal(treasuryBefore + FEE);
    expect(await ethers.provider.getBalance(f.factory)).to.equal(0);
    expect(await f.collateral.locked()).to.equal(0);
    expect(await f.market.proposalEvidenceHash()).to.equal(ethers.ZeroHash);
    expect(await f.market.disputeEvidenceHash()).to.equal(ethers.ZeroHash);
  });

  it('commits every critical event term with deterministic onchain hashes', async () => {
    const f = await loadFixture(fixture);
    const metadata = eventMetadata();
    expect(await f.market.questionHash()).to.equal(ethers.keccak256(ethers.toUtf8Bytes(metadata.question)));
    expect(await f.market.yesOutcomeHash()).to.equal(ethers.keccak256(ethers.toUtf8Bytes(metadata.yesOutcome)));
    expect(await f.market.noOutcomeHash()).to.equal(ethers.keccak256(ethers.toUtf8Bytes(metadata.noOutcome)));
    expect(await f.market.resolutionRulesHash()).to.equal(ethers.keccak256(ethers.toUtf8Bytes(metadata.rules)));
    expect(await f.market.primarySourceHash()).to.equal(ethers.keccak256(ethers.toUtf8Bytes(metadata.primarySource)));
    expect(await f.market.secondarySourceHash()).to.equal(ethers.keccak256(ethers.toUtf8Bytes(metadata.secondarySource)));
    expect(await f.market.resolutionTimestampHash()).to.equal(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint64'], [f.eventTimes.resolvesAt])));
    expect(await f.market.metadataHash()).to.not.equal(ethers.ZeroHash);
  });

  it('stores general-purpose text and exposes no mutation or deletion surface', async () => {
    const f = await loadFixture(fixture);
    const metadata = await f.market.metadata();
    expect(metadata.category).to.equal('Tech');
    expect(metadata.primarySource).to.include('newsroom');
    for (const name of ['setQuestion', 'setRules', 'setSource', 'setResolutionTimestamp', 'deleteMarket', 'withdraw'])
      expect(f.market.interface.hasFunction(name)).to.equal(false);
    await f.pair();
    expect(await f.market.hasTraded()).to.equal(true);
    expect((await f.market.metadata()).question).to.equal(metadata.question);
  });

  it('bounds free-form fields and requires deterministic event terms', async () => {
    const f = await loadFixture(fixture);
    for (const metadata of [eventMetadata({ question: '' }), eventMetadata({ yesOutcome: '' }),
      eventMetadata({ noOutcome: '' }), eventMetadata({ rules: '' }), eventMetadata({ primarySource: '' }),
      eventMetadata({ question: 'x'.repeat(281) }), eventMetadata({ rules: 'x'.repeat(2049) }),
      eventMetadata({ primarySource: 'x'.repeat(513) })]) {
      await expect(f.factory.createEventMarket(f.eventTimes.closesAt, f.eventTimes.resolvesAt, metadata, { value: FEE }))
        .to.be.revertedWithCustomError(f.market, 'InvalidMetadata');
    }
  });

  it('rejects bad fees, timelines, protocol parameters and reentrant treasury failures', async () => {
    const f = await loadFixture(fixture);
    for (const value of [0n, FEE - 1n, FEE + 1n])
      await expect(f.factory.createEventMarket(f.eventTimes.closesAt, f.eventTimes.resolvesAt, eventMetadata(), { value }))
        .to.be.revertedWithCustomError(f.factory, 'IncorrectListingFee');
    await expect(f.factory.createEventMarket(1, 2, eventMetadata(), { value: FEE }))
      .to.be.revertedWithCustomError(f.market, 'InvalidTimeline');
    const reject = await ethers.deployContract('RejectETH');
    const implementations = await deployMarketImplementations(
      f.deployer, f.token.target, f.autoResolver.target, f.resolverSigner.address);
    const factory = await ethers.deployContract('MarketFactory', [f.token.target, reject.target, f.autoResolver.target,
      f.resolverSigner.address, BOND, DISPUTE_PERIOD,
      implementations.autoMarketImplementation.target, implementations.eventMarketImplementation.target]);
    await expect(factory.createEventMarket(f.eventTimes.closesAt, f.eventTimes.resolvesAt, eventMetadata(), { value: FEE }))
      .to.be.revertedWithCustomError(factory, 'TreasuryTransferFailed');
    expect(await factory.marketCount()).to.equal(0);
  });
});

describe('Shared escrow, matching, secondary sales and fees', function () {
  it('mints a fully backed YES/NO pair and keeps fees outside collateral', async () => {
    const f = await loadFixture(fixture);
    const beforeA = await f.token.balanceOf(f.alice);
    const beforeB = await f.token.balanceOf(f.bob);
    await f.pair();
    expect(beforeA - await f.token.balanceOf(f.alice)).to.equal(60_600_000n);
    expect(beforeB - await f.token.balanceOf(f.bob)).to.equal(40_400_000n);
    expect(await f.collateral.locked()).to.equal(100n * UNIT);
    expect(await f.token.balanceOf(f.collateral)).to.equal(100n * UNIT);
    expect(await f.token.balanceOf(f.treasury)).to.equal(400_000n);
    expect(await f.feeVault.claimable(f.creator)).to.equal(600_000n);
    expect(await f.book.escrowedUSDG()).to.equal(0);
  });

  it('charges exactly 1%, split 0.4% treasury and 0.6% creator', async () => {
    const f = await loadFixture(fixture);
    await f.pair(1000n);
    expect(await f.collateral.locked()).to.equal(1000n * UNIT);
    expect(await f.token.balanceOf(f.treasury)).to.equal(4n * UNIT);
    expect(await f.feeVault.claimable(f.creator)).to.equal(6n * UNIT);
  });

  it('refunds unmatched principal and unearned fees on cancellation', async () => {
    const f = await loadFixture(fixture);
    const before = await f.token.balanceOf(f.alice);
    const id = await f.place(f.alice, true, true, 37, 9);
    expect(await f.collateral.locked()).to.equal(0);
    await f.book.connect(f.alice).cancelOrder(id);
    expect(await f.token.balanceOf(f.alice)).to.equal(before);
    expect(await f.book.escrowedUSDG()).to.equal(0);
    await expect(f.book.connect(f.alice).cancelOrder(id)).to.be.revertedWithCustomError(f.book, 'InactiveOrder');
  });

  it('preserves exact accounting through partial fills', async () => {
    const f = await loadFixture(fixture);
    const yes = await f.place(f.alice, true, true, 33, 100);
    const no = await f.place(f.bob, false, true, 67, 20);
    await f.book.matchOrders(yes, no, 7);
    await f.book.matchOrders(yes, no, 13);
    expect((await f.book.orders(yes)).remaining).to.equal(80);
    await f.book.connect(f.alice).cancelOrder(yes);
    expect(await f.collateral.locked()).to.equal(20n * UNIT);
    expect(await f.book.escrowedUSDG()).to.equal(0);
  });

  it('supports secondary YES and NO sales without reducing backing', async () => {
    const f = await loadFixture(fixture);
    await f.pair();
    for (const [seller, buyer, yes, price] of [[f.alice, f.carol, true, 75], [f.bob, f.dave, false, 35]]) {
      const before = await f.token.balanceOf(seller);
      const sell = await f.place(seller, yes, false, price, 20);
      const buy = await f.place(buyer, yes, true, price, 20);
      await f.book.matchOrders(sell, buy, 20);
      expect(await f.token.balanceOf(seller) - before).to.equal(20n * BigInt(price) * 10_000n);
    }
    expect(await f.collateral.locked()).to.equal(100n * UNIT);
    expect(await f.market.sharesOf(f.carol, true)).to.equal(20);
    expect(await f.market.sharesOf(f.dave, false)).to.equal(20);
  });

  it('returns unmatched selling shares after close or final resolution', async () => {
    const f = await loadFixture(fixture);
    await f.pair();
    const id = await f.place(f.alice, true, false, 80, 50);
    await time.increaseTo(f.eventTimes.resolvesAt);
    await f.market.connect(f.carol).propose(1, 'ipfs://yes-evidence');
    await time.increase(DISPUTE_PERIOD);
    await f.market.finalize();
    await f.book.connect(f.dave).cancelOrder(id);
    expect(await f.market.sharesOf(f.alice, true)).to.equal(100);
  });

  it('allows creator fee claims without touching collateral or bonds', async () => {
    const f = await loadFixture(fixture);
    await f.pair();
    await time.increaseTo(f.eventTimes.resolvesAt);
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    const bondBefore = await f.market.bondEscrowed();
    await f.feeVault.connect(f.creator).claim();
    expect(await f.collateral.locked()).to.equal(100n * UNIT);
    expect(await f.market.bondEscrowed()).to.equal(bondBefore);
    await expect(f.feeVault.connect(f.creator).claim()).to.be.revertedWithCustomError(f.feeVault, 'NothingToClaim');
  });

  it('rejects incompatible, expired, self-matched, zero and double fills', async () => {
    const f = await loadFixture(fixture);
    const yes = await f.place(f.alice, true, true, 60, 10);
    const bad = await f.place(f.bob, false, true, 41, 10);
    await expect(f.book.matchOrders(yes, bad, 1)).to.be.revertedWithCustomError(f.book, 'IncompatibleOrders');
    const self = await f.place(f.alice, false, true, 40, 10);
    await expect(f.book.matchOrders(yes, self, 1)).to.be.revertedWithCustomError(f.book, 'IncompatibleOrders');
    const no = await f.place(f.bob, false, true, 40, 10);
    await expect(f.book.matchOrders(yes, no, 0)).to.be.revertedWithCustomError(f.book, 'InvalidFill');
    await f.book.matchOrders(yes, no, 10);
    await expect(f.book.matchOrders(yes, no, 1)).to.be.revertedWithCustomError(f.book, 'InactiveOrder');
    await time.increaseTo(f.eventTimes.closesAt);
    await expect(f.place(f.carol, true, true, 50, 1)).to.be.revertedWithCustomError(f.book, 'TradingClosed');
  });

  it('rejects transfer-tax collateral and privileged collateral access', async () => {
    const taxed = await fixture('TaxToken');
    await expect(taxed.place(taxed.alice, true, true, 50, 10)).to.be.revertedWithCustomError(taxed.book, 'UnsupportedToken');
    const f = await loadFixture(fixture);
    await expect(f.market.connect(f.creator).mintPair(f.creator, f.creator, 100)).to.be.revertedWithCustomError(f.market, 'Unauthorized');
    await expect(f.collateral.connect(f.creator).release(f.creator, 1)).to.be.revertedWithCustomError(f.collateral, 'Unauthorized');
    await expect(f.feeVault.connect(f.treasury).collect(f.market, 100)).to.be.revertedWithCustomError(f.feeVault, 'Unauthorized');
  });
});

describe('Optimistic event resolution and isolated bonds', function () {
  async function readyEvent() {
    const f = await loadFixture(fixture);
    await f.pair();
    await time.increaseTo(f.eventTimes.resolvesAt);
    return f;
  }

  it('enforces the explicit OPEN and CLOSED states and rejects early proposals', async () => {
    const f = await loadFixture(fixture);
    expect(await f.market.marketState()).to.equal(0);
    await expect(f.market.propose(1, 'ipfs://evidence')).to.be.revertedWithCustomError(f.market, 'InvalidState');
    await time.increaseTo(f.eventTimes.closesAt);
    expect(await f.market.marketState()).to.equal(1);
    await expect(f.market.propose(1, 'ipfs://evidence')).to.be.revertedWithCustomError(f.market, 'InvalidState');
  });

  it('accepts YES, NO or INVALID proposals with an exact 25 USDG isolated bond', async () => {
    for (const outcome of [1, 2, 3]) {
      const f = await fixture();
      await f.pair();
      await time.increaseTo(f.eventTimes.resolvesAt);
      const collateralBefore = await f.collateral.locked();
      await f.market.connect(f.carol).propose(outcome, `ipfs://evidence-${outcome}`);
      expect(await f.market.marketState()).to.equal(2);
      expect(await f.market.bondEscrowed()).to.equal(BOND);
      expect(await f.token.balanceOf(f.market)).to.equal(BOND);
      expect(await f.collateral.locked()).to.equal(collateralBefore);
      expect(await f.market.disputeDeadline()).to.equal(BigInt(await time.latest()) + BigInt(DISPUTE_PERIOD));
    }
  });

  it('rejects empty/oversized evidence, NONE outcomes and second proposals', async () => {
    const f = await readyEvent();
    await expect(f.market.connect(f.carol).propose(0, 'ipfs://x')).to.be.revertedWithCustomError(f.market, 'InvalidOutcome');
    await expect(f.market.connect(f.carol).propose(1, '')).to.be.revertedWithCustomError(f.market, 'InvalidEvidence');
    await expect(f.market.connect(f.carol).propose(1, 'x'.repeat(513))).to.be.revertedWithCustomError(f.market, 'InvalidEvidence');
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await expect(f.market.connect(f.dave).propose(2, 'ipfs://no')).to.be.revertedWithCustomError(f.market, 'InvalidState');
  });

  it('allows one alternative dispute inside 24 hours and isolates the matching bond', async () => {
    const f = await readyEvent();
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await expect(f.market.connect(f.carol).dispute(2, 'ipfs://no')).to.be.revertedWithCustomError(f.market, 'SameParty');
    await expect(f.market.connect(f.dave).dispute(1, 'ipfs://same')).to.be.revertedWithCustomError(f.market, 'InvalidOutcome');
    await f.market.connect(f.dave).dispute(2, 'ipfs://no');
    expect(await f.market.marketState()).to.equal(3);
    expect(await f.market.bondEscrowed()).to.equal(2n * BOND);
    expect(await f.token.balanceOf(f.market)).to.equal(2n * BOND);
    expect(await f.collateral.locked()).to.equal(100n * UNIT);
    await expect(f.market.connect(f.alice).dispute(3, 'ipfs://invalid')).to.be.revertedWithCustomError(f.market, 'InvalidState');
  });

  it('rejects disputes at and after the deadline', async () => {
    const f = await readyEvent();
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await time.increaseTo(await f.market.disputeDeadline());
    await expect(f.market.connect(f.dave).dispute(2, 'ipfs://no')).to.be.revertedWithCustomError(f.market, 'DisputeWindowClosed');
  });

  it('allows permissionless undisputed finalization and returns the proposer bond', async () => {
    const f = await readyEvent();
    const before = await f.token.balanceOf(f.carol);
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await expect(f.market.connect(f.alice).finalize()).to.be.revertedWithCustomError(f.market, 'DisputeWindowOpen');
    await time.increaseTo(await f.market.disputeDeadline());
    await f.market.connect(f.alice).finalize();
    expect(await f.market.resolvedOutcome()).to.equal(1);
    expect(await f.token.balanceOf(f.carol)).to.equal(before);
    expect(await f.market.bondEscrowed()).to.equal(0);
    await expect(f.market.finalize()).to.be.revertedWithCustomError(f.market, 'InvalidState');
  });

  it('restricts disputed adjudication to the configured resolver only', async () => {
    const f = await readyEvent();
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await f.market.connect(f.dave).dispute(2, 'ipfs://no');
    for (const actor of [f.creator, f.treasury, f.alice, f.carol, f.dave])
      await expect(f.market.connect(actor).adjudicate(1)).to.be.revertedWithCustomError(f.market, 'Unauthorized');
    await f.market.connect(f.resolverSigner).adjudicate(1);
    expect(await f.market.marketState()).to.equal(4);
    await expect(f.market.connect(f.resolverSigner).adjudicate(2)).to.be.revertedWithCustomError(f.market, 'InvalidState');
  });

  it('awards both bonds to the proposer when the proposer wins', async () => {
    const f = await readyEvent();
    const proposerBefore = await f.token.balanceOf(f.carol);
    const disputerBefore = await f.token.balanceOf(f.dave);
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await f.market.connect(f.dave).dispute(2, 'ipfs://no');
    await f.market.connect(f.resolverSigner).adjudicate(1);
    expect(await f.token.balanceOf(f.carol)).to.equal(proposerBefore + BOND);
    expect(await f.token.balanceOf(f.dave)).to.equal(disputerBefore - BOND);
    expect(await f.token.balanceOf(f.market)).to.equal(0);
  });

  it('awards both bonds to the disputer when the disputer wins', async () => {
    const f = await readyEvent();
    const proposerBefore = await f.token.balanceOf(f.carol);
    const disputerBefore = await f.token.balanceOf(f.dave);
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await f.market.connect(f.dave).dispute(2, 'ipfs://no');
    await f.market.connect(f.resolverSigner).adjudicate(2);
    expect(await f.token.balanceOf(f.carol)).to.equal(proposerBefore - BOND);
    expect(await f.token.balanceOf(f.dave)).to.equal(disputerBefore + BOND);
  });

  it('returns each bond when the resolver selects the third outcome', async () => {
    const f = await readyEvent();
    const proposerBefore = await f.token.balanceOf(f.carol);
    const disputerBefore = await f.token.balanceOf(f.dave);
    await f.market.connect(f.carol).propose(1, 'ipfs://yes');
    await f.market.connect(f.dave).dispute(2, 'ipfs://no');
    await f.market.connect(f.resolverSigner).adjudicate(3);
    expect(await f.token.balanceOf(f.carol)).to.equal(proposerBefore);
    expect(await f.token.balanceOf(f.dave)).to.equal(disputerBefore);
    expect(await f.market.resolvedOutcome()).to.equal(3);
  });

  it('redeems YES and NO outcomes at exactly 1 or 0 USDG without double redemption', async () => {
    for (const outcome of [1, 2]) {
      const f = await fixture();
      await f.pair(100n);
      await time.increaseTo(f.eventTimes.resolvesAt);
      await f.market.connect(f.carol).propose(outcome, 'ipfs://evidence');
      await time.increase(DISPUTE_PERIOD);
      await f.market.finalize();
      const winner = outcome === 1 ? f.alice : f.bob;
      const side = outcome === 1;
      const before = await f.token.balanceOf(winner);
      await f.market.connect(winner).redeem(side, 100);
      expect(await f.token.balanceOf(winner) - before).to.equal(100n * UNIT);
      await expect(f.market.connect(winner).redeem(side, 1)).to.be.reverted;
    }
  });

  it('redeems INVALID at exactly 0.5 USDG per YES and NO share and conserves collateral', async () => {
    const f = await readyEvent();
    await f.market.connect(f.carol).propose(3, 'ipfs://invalid');
    await time.increase(DISPUTE_PERIOD);
    await f.market.finalize();
    const yesBefore = await f.token.balanceOf(f.alice);
    const noBefore = await f.token.balanceOf(f.bob);
    await f.market.connect(f.alice).redeem(true, 100);
    expect(await f.token.balanceOf(f.alice) - yesBefore).to.equal(50n * UNIT);
    expect(await f.collateral.locked()).to.equal(50n * UNIT);
    await f.market.connect(f.bob).redeem(false, 100);
    expect(await f.token.balanceOf(f.bob) - noBefore).to.equal(50n * UNIT);
    expect(await f.collateral.locked()).to.equal(0);
  });

  it('gives resolver, creator and treasury no collateral or rule-changing powers', async () => {
    const f = await readyEvent();
    for (const actor of [f.resolverSigner, f.creator, f.treasury]) {
      await expect(f.collateral.connect(actor).release(actor.address, UNIT)).to.be.revertedWithCustomError(f.collateral, 'Unauthorized');
      await expect(f.market.connect(actor).releaseShares(actor.address, true, 1)).to.be.revertedWithCustomError(f.market, 'Unauthorized');
    }
    expect(f.market.interface.hasFunction('setResolver')).to.equal(false);
    expect(f.market.interface.hasFunction('setMetadata')).to.equal(false);
  });
});

describe('Uniswap V3 historical TWAP automatic resolution', function () {
  it('binds only the approved WETH/USDG pool and generates canonical AUTO metadata', async () => {
    const f = await loadFixture(fixture);
    const { market } = await f.createAuto();
    const metadata = await market.metadata();
    expect(metadata.question).to.include('ETH/USDG');
    expect(metadata.rules).to.include('60-minute');
    expect(metadata.rules).to.include('ending exactly at the resolution timestamp');
    expect(metadata.primarySource.toLowerCase()).to.include(f.pool.target.slice(2).toLowerCase());
    expect(await f.autoResolver.weth()).to.equal(f.weth.target);
    expect(await f.autoResolver.usdg()).to.equal(f.token.target);
    expect(await f.autoResolver.pool()).to.equal(f.pool.target);
  });

  it('rejects early resolution and resolves threshold comparisons in both directions', async () => {
    const f = await loadFixture(fixture);
    const above = await f.createAuto(f.creator, { threshold: 2000n * UNIT, condition: 0 });
    await expect(above.market.resolve()).to.be.revertedWithCustomError(above.market, 'NotReady');
    await time.increaseTo(above.terms.resolvesAt);
    await above.market.resolve();
    expect(await above.market.resolvedOutcome()).to.equal(1);
    const below = await f.createAuto(f.creator, { threshold: 2000n * UNIT, condition: 1 });
    await time.increaseTo(below.terms.resolvesAt);
    await below.market.resolve();
    expect(await below.market.resolvedOutcome()).to.equal(2);
  });

  it('uses the historical interval ending at resolvesAt even when resolve is delayed', async () => {
    const f = await loadFixture(fixture);
    const wethIsToken0 = (await f.pool.token0()).toLowerCase() === f.weth.target.toLowerCase();
    const beforeTick = Math.floor(Math.log(wethIsToken0 ? 2000e6 / 1e18 : 1e18 / 2000e6) / Math.log(1.0001));
    const afterTick = Math.floor(Math.log(wethIsToken0 ? 10000e6 / 1e18 : 1e18 / 10000e6) / Math.log(1.0001));
    const created = await f.createAuto(f.creator, { threshold: 3000n * UNIT });
    await f.pool.setTickSchedule(beforeTick, afterTick, created.terms.resolvesAt + 1);
    await time.increaseTo(created.terms.resolvesAt + 3600);
    await created.market.resolve();
    expect(await created.market.resolvedOutcome()).to.equal(2);
  });

  it('rejects fake tokens, wrong pools and unsupported pairs at construction', async () => {
    const f = await loadFixture(fixture);
    const fake = await ethers.deployContract('MockWETH');
    const wrongPool = await ethers.deployContract('MockV3Pool', [f.weth.target, fake.target, 3000, 0]);
    await expect(ethers.deployContract('UniswapTwapResolver', [f.weth.target, f.token.target, wrongPool.target, 3600]))
      .to.be.revertedWithCustomError(f.autoResolver, 'InvalidConfiguration');
    await expect(ethers.deployContract('UniswapTwapResolver', [f.alice.address, f.token.target, f.pool.target, 3600]))
      .to.be.revertedWithCustomError(f.autoResolver, 'InvalidConfiguration');
  });

  it('fails closed when the pool lacks historical observation capacity', async () => {
    const f = await loadFixture(fixture);
    const created = await f.createAuto(f.creator, { threshold: 2000n * UNIT });
    await f.pool.setHistoryAvailable(false);
    await time.increaseTo(created.terms.resolvesAt);
    await expect(created.market.resolve()).to.be.revertedWith('OLD');
    expect(await created.market.resolved()).to.equal(false);
  });

  it('never exposes a spot-price, pool-change, token-change or manual outcome function', async () => {
    const f = await loadFixture(fixture);
    for (const name of ['setPool', 'setWeth', 'setUSDG', 'spotPrice', 'setOutcome', 'owner'])
      expect(f.autoResolver.interface.hasFunction(name)).to.equal(false);
  });
});
