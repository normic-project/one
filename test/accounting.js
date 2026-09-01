const { expect } = require('chai');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { fixture, UNIT } = require('./helpers.cjs');

async function assertSolvent(f) {
  let expectedEscrow = 0n;
  let sellYes = 0n;
  let sellNo = 0n;
  for (let id = 1n; id < await f.book.nextOrderId(); id++) {
    const o = await f.book.orders(id);
    if (o.buy) expectedEscrow += o.remaining * o.price * 10100n;
    else if (o.yes) sellYes += o.remaining;
    else sellNo += o.remaining;
  }
  expect(await f.book.escrowedUSDG()).to.equal(expectedEscrow);
  expect(await f.token.balanceOf(f.book)).to.equal(expectedEscrow);
  expect(await f.token.balanceOf(f.feeVault)).to.equal(await f.feeVault.totalClaimable());
  expect(await f.token.balanceOf(f.collateral)).to.equal(await f.collateral.locked());
  expect(await f.market.sharesOf(f.book, true)).to.equal(sellYes);
  expect(await f.market.sharesOf(f.book, false)).to.equal(sellNo);
  for (const side of [true, false]) {
    let sum = await f.market.sharesOf(f.book, side);
    for (const trader of f.traders) sum += await f.market.sharesOf(trader, side);
    expect(sum).to.equal(await f.market.totalShares(side));
  }
  if (!(await f.market.resolved())) {
    expect(await f.market.totalShares(true)).to.equal(await f.market.totalShares(false));
    expect(await f.collateral.locked()).to.equal(await f.market.totalShares(true) * UNIT);
  } else {
    const outcome = Number(await f.market.resolvedOutcome());
    const expected = outcome === 3
      ? (await f.market.totalShares(true) + await f.market.totalShares(false)) * 500_000n
      : await f.market.totalShares(outcome === 1) * UNIT;
    expect(await f.collateral.locked()).to.equal(expected);
  }
  expect(await f.token.balanceOf(f.market)).to.equal(0);
}

describe('Accounting invariants', function () {
  it('keeps all stores solvent across 160 deterministic randomized multi-actor operations', async () => {
    const f = await loadFixture(fixture);
    let seed = 0x197d7ae2;
    const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let step = 0; step < 160; step++) {
      const a = f.traders[random(4)];
      const b = f.traders[(f.traders.indexOf(a) + 1 + random(3)) % 4];
      const qty = BigInt(1 + random(70));
      const price = 1 + random(99);
      switch (random(4)) {
        case 0: {
          await f.pair(qty, price, a, b);
          break;
        }
        case 1: {
          const id = await f.place(a, random(2) === 1, true, price, qty);
          if (random(2)) await f.book.connect(a).cancelOrder(id);
          break;
        }
        case 2: {
          const yes = random(2) === 1;
          const available = await f.market.sharesOf(a, yes);
          if (available === 0n) break;
          const shares = qty < available ? qty : available;
          const sell = await f.place(a, yes, false, price, shares);
          if (random(2)) {
            const buy = await f.place(b, yes, true, price, shares);
            await f.book.matchOrders(sell, buy, shares);
          } else await f.book.connect(a).cancelOrder(sell);
          break;
        }
        case 3:
          if (await f.feeVault.claimable(f.creator) > 0) await f.feeVault.connect(f.creator).claim();
      }
      await assertSolvent(f);
    }
    await time.increaseTo(f.eventTimes.resolvesAt);
    await f.market.connect(f.resolverSigner).resolve(1);
    for (let id = 1n; id < await f.book.nextOrderId(); id++)
      if ((await f.book.orders(id)).remaining > 0) await f.book.cancelOrder(id);
    for (const trader of f.traders) {
      for (const side of [true, false]) {
        const balance = await f.market.sharesOf(trader, side);
        if (balance > 0) await f.market.connect(trader).redeem(side, balance);
      }
      await assertSolvent(f);
    }
    expect(await f.collateral.locked()).to.equal(0);
  });
  it('has identical fees for one fill or many one-share fills at every cent tick', async () => {
    const f = await loadFixture(fixture);
    for (let price = 1; price < 100; price++) {
      const before = await f.feeVault.totalClaimable();
      const yes = await f.place(f.alice, true, true, price, 3);
      const no = await f.place(f.bob, false, true, 100 - price, 3);
      for (let i = 0; i < 3; i++) await f.book.matchOrders(yes, no, 1);
      expect(await f.feeVault.totalClaimable() - before).to.equal(18000n);
    }
    await assertSolvent(f);
  });
});
