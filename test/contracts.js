const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { fixture, eventMetadata, deployMarketImplementation, UNIT, FEE } = require('./helpers.cjs');

describe('Factory, clones and immutable metadata', function () {
  it('locks the implementation and initializes each clone exactly once', async () => {
    const f = await loadFixture(fixture);
    const latest = await time.latest();
    await expect(f.market.initialize(f.creator.address, latest + 3600, latest + 3700, eventMetadata()))
      .to.be.revertedWithCustomError(f.market, 'AlreadyInitialized');
    const cloneCode = (await ethers.provider.getCode(f.market.target)).toLowerCase();
    expect((cloneCode.length - 2) / 2).to.equal(45);
    expect(cloneCode).to.include(f.eventMarketImplementation.target.toLowerCase().slice(2));
    expect(await f.eventMarketImplementation.token()).to.equal(f.token.target);
    expect(await f.eventMarketImplementation.settlement()).to.equal(f.book.target);
    expect(await f.eventMarketImplementation.resolverMultisig()).to.equal(f.resolverSigner.address);
    for (const name of ['setEventMarketImplementation', 'upgradeTo', 'upgradeToAndCall'])
      expect(f.factory.interface.hasFunction(name)).to.equal(false);
  });

  it('creates general event markets and forwards every listing fee without liquidity', async () => {
    const f = await loadFixture(fixture);
    const treasuryBefore = await ethers.provider.getBalance(f.treasury);
    await f.createEvent();
    expect(await ethers.provider.getBalance(f.treasury)).to.equal(treasuryBefore + FEE);
    expect(await ethers.provider.getBalance(f.factory)).to.equal(0);
    expect(await f.collateral.locked()).to.equal(0);
    expect(f.factory.interface.hasFunction('createAutoMarket')).to.equal(false);
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
    const implementation = await deployMarketImplementation(f.deployer, f.token.target, f.resolverSigner.address);
    const factory = await ethers.deployContract('MarketFactory', [f.token.target, reject.target,
      f.resolverSigner.address, implementation.eventMarketImplementation.target]);
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
    await f.market.connect(f.resolverSigner).resolve(1);
    await f.book.connect(f.dave).cancelOrder(id);
    expect(await f.market.sharesOf(f.alice, true)).to.equal(100);
  });

  it('allows creator fee claims without touching collateral', async () => {
    const f = await loadFixture(fixture);
    await f.pair();
    await f.feeVault.connect(f.creator).claim();
    expect(await f.collateral.locked()).to.equal(100n * UNIT);
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

describe('Resolver Safe final resolution', function () {
  it('enforces OPEN/CLOSED timing, resolver-only access, valid outcomes and one-time resolution', async () => {
    const f = await loadFixture(fixture);
    expect(await f.market.marketState()).to.equal(0);
    await time.increaseTo(f.eventTimes.closesAt);
    expect(await f.market.marketState()).to.equal(1);
    await expect(f.market.connect(f.resolverSigner).resolve(1)).to.be.revertedWithCustomError(f.market, 'NotReady');
    await time.increaseTo(f.eventTimes.resolvesAt);
    await expect(f.market.connect(f.carol).resolve(1)).to.be.revertedWithCustomError(f.market, 'Unauthorized');
    await expect(f.market.connect(f.resolverSigner).resolve(0)).to.be.revertedWithCustomError(f.market, 'InvalidAmount');
    await expect(f.market.connect(f.resolverSigner).resolve(1)).to.emit(f.market, 'Resolved').withArgs(1);
    expect(await f.market.marketState()).to.equal(2);
    await expect(f.market.connect(f.resolverSigner).resolve(2)).to.be.revertedWithCustomError(f.market, 'AlreadyResolved');
  });

  it('redeems YES and NO outcomes at exactly 1 or 0 USDG without double redemption', async () => {
    const f = await loadFixture(fixture);
    const noCase = await f.createEvent();
    await f.pair(100n, 60, f.alice, f.bob, noCase.market.target);
    await f.pair(100n);
    await time.increaseTo(f.eventTimes.resolvesAt);
    await f.market.connect(f.resolverSigner).resolve(1);
    await noCase.market.connect(f.resolverSigner).resolve(2);
    const aliceBefore = await f.token.balanceOf(f.alice);
    await f.market.connect(f.alice).redeem(true, 100);
    expect(await f.token.balanceOf(f.alice) - aliceBefore).to.equal(100n * UNIT);
    await f.market.connect(f.bob).redeem(false, 100);
    expect(await f.collateral.locked()).to.equal(0);
    await expect(f.market.connect(f.alice).redeem(true, 100)).to.be.reverted;
    const bobBefore = await f.token.balanceOf(f.bob);
    await noCase.market.connect(f.bob).redeem(false, 100);
    expect(await f.token.balanceOf(f.bob) - bobBefore).to.equal(100n * UNIT);
    await noCase.market.connect(f.alice).redeem(true, 100);
    const noVault = await ethers.getContractAt('CollateralVault', await noCase.market.collateralVault());
    expect(await noVault.locked()).to.equal(0);
  });

  it('redeems INVALID at exactly 0.5 USDG per side and conserves a complete pair', async () => {
    const f = await loadFixture(fixture);
    await f.pair(101n);
    await time.increaseTo(f.eventTimes.resolvesAt);
    await f.market.connect(f.resolverSigner).resolve(3);
    const aliceBefore = await f.token.balanceOf(f.alice);
    const bobBefore = await f.token.balanceOf(f.bob);
    await f.market.connect(f.alice).redeem(true, 101);
    await f.market.connect(f.bob).redeem(false, 101);
    expect(await f.token.balanceOf(f.alice) - aliceBefore).to.equal(50_500_000n);
    expect(await f.token.balanceOf(f.bob) - bobBefore).to.equal(50_500_000n);
    expect(await f.collateral.locked()).to.equal(0);
  });

  it('gives resolver, creator and treasury no collateral, fee, metadata, share or order powers', async () => {
    const f = await loadFixture(fixture);
    for (const name of ['withdraw', 'setQuestion', 'setRules', 'setSource', 'setClosesAt', 'setResolvesAt',
      'setFee', 'transferShares', 'cancelOrder']) expect(f.market.interface.hasFunction(name)).to.equal(false);
    await expect(f.market.connect(f.creator).resolve(1)).to.be.revertedWithCustomError(f.market, 'Unauthorized');
    await expect(f.market.connect(f.resolverSigner).mintPair(f.resolverSigner, f.resolverSigner, 1))
      .to.be.revertedWithCustomError(f.market, 'Unauthorized');
    await expect(f.collateral.connect(f.resolverSigner).release(f.resolverSigner, 1))
      .to.be.revertedWithCustomError(f.collateral, 'Unauthorized');
    await expect(f.feeVault.connect(f.resolverSigner).claim()).to.be.revertedWithCustomError(f.feeVault, 'NothingToClaim');
    expect(await f.factory.resolverMultisig()).to.equal(f.resolverSigner.address);
  });
});
