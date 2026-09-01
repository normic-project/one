const { expect } = require('chai');
const { ethers } = require('hardhat');
const { fixture, FEE, UNIT } = require('./helpers.cjs');

describe('Callback and reentrancy boundaries', () => {
  it('blocks token callbacks from reentering order settlement, cancellation and fee claims', async () => {
    const f = await fixture('ReentrantToken');
    await f.token.arm(f.book.target, f.book.interface.encodeFunctionData('cancelOrder', [1]));
    const y = await f.place(f.alice, true, true, 60, 100);
    expect(await f.token.blocked()).to.equal(true);
    const n = await f.place(f.bob, false, true, 40, 100);
    await f.token.arm(f.book.target, f.book.interface.encodeFunctionData('matchOrders', [y, n, 100]));
    await f.book.matchOrders(y, n, 100);
    expect(await f.token.blocked()).to.equal(true);
    await f.token.arm(f.feeVault.target, f.feeVault.interface.encodeFunctionData('claim'));
    await f.feeVault.connect(f.creator).claim();
    expect(await f.token.blocked()).to.equal(true);
    expect(await f.collateral.locked()).to.equal(100n * UNIT);
    expect(await f.book.escrowedUSDG()).to.equal(0);
    expect(await f.feeVault.totalClaimable()).to.equal(0);
  });
  it('blocks listing-fee recipient callbacks from recursively creating markets', async () => {
    const treasury = await ethers.deployContract('ReentrantTreasury');
    const f = await fixture('MockUSDG', treasury.target);
    const raw = await f.market.metadata();
    const metadata = { question: raw.question, yesOutcome: raw.yesOutcome, noOutcome: raw.noOutcome,
      category: raw.category, rules: raw.rules, primarySource: raw.primarySource,
      secondarySource: raw.secondarySource, metadataURI: raw.metadataURI };
    await treasury.arm(f.factory.target, f.factory.interface.encodeFunctionData('createEventMarket',
      [f.eventTimes.closesAt, f.eventTimes.resolvesAt, metadata]));
    await f.factory.createEventMarket(f.eventTimes.closesAt, f.eventTimes.resolvesAt, metadata, { value: FEE });
    expect(await treasury.blocked()).to.equal(true);
    expect(await f.factory.marketCount()).to.equal(2);
    expect(await ethers.provider.getBalance(treasury)).to.equal(2n * FEE);
  });
});
