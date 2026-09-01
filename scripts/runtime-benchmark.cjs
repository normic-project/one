const fs = require('node:fs');
const assert = require('node:assert/strict');
const { ethers, network } = require('hardhat');

const helper = process.env.BASELINE_SNAPSHOT === '1'
  ? require('../reports/pre-clone-source/test/helpers.cjs')
  : require('../test/helpers.cjs');
const { fixture, eventMetadata, UNIT, FEE, DISPUTE_PERIOD } = helper;

async function gas(tx) { return (await (await tx).wait()).gasUsed; }

async function createEvent(factory, owner, closesAt, resolvesAt, suffix) {
  const tx = await factory.connect(owner).createEventMarket(closesAt, resolvesAt, eventMetadata({
    question: `Will benchmark event ${suffix} occur?`,
    primarySource: `https://example.com/benchmark/${suffix}`
  }), { value: FEE });
  const receipt = await tx.wait();
  const address = await factory.markets((await factory.marketCount()) - 1n);
  return { market: await ethers.getContractAt('EventMarket', address), gas: receipt.gasUsed };
}

async function place(book, signer, request) {
  const id = await book.nextOrderId();
  const tx = await book.connect(signer).placeOrder(request);
  return { id, gas: (await tx.wait()).gasUsed };
}

async function pair(book, market, yesBuyer, noBuyer, shares) {
  const expiresAt = await market.closesAt();
  const yes = await place(book, yesBuyer, { market: market.target, expiresAt,
    price: 60, yes: true, buy: true, shares });
  const no = await place(book, noBuyer, { market: market.target, expiresAt,
    price: 40, yes: false, buy: true, shares });
  return { yes, no };
}

async function main() {
  const f = await fixture();
  const latest = Number((await ethers.provider.getBlock('latest')).timestamp);
  const closesAt = latest + 600;
  const resolvesAt = latest + 700;
  const actors = [f.creator, f.alice, f.bob, f.carol, f.dave];
  const result = {};

  const autoTerms = { threshold: 3000n * UNIT, closesAt, resolvesAt, condition: 0 };
  const autoTx = await f.factory.connect(f.creator).createAutoMarket(autoTerms, { value: FEE });
  const autoReceipt = await autoTx.wait();
  result.createAutoMarket = autoReceipt.gasUsed;
  const auto = await ethers.getContractAt('AutoMarket', await f.factory.markets((await f.factory.marketCount()) - 1n));

  const yesEvent = await createEvent(f.factory, f.creator, closesAt, resolvesAt, 'yes');
  const noEvent = await createEvent(f.factory, f.creator, closesAt, resolvesAt, 'no');
  const invalidEvent = await createEvent(f.factory, f.creator, closesAt, resolvesAt, 'invalid');
  result.createEventMarket = yesEvent.gas;
  for (const event of [yesEvent.market, noEvent.market, invalidEvent.market]) {
    for (const actor of actors) await f.token.connect(actor).approve(event.target, ethers.MaxUint256);
  }

  const primary = await pair(f.book, auto, f.alice, f.bob, 20n);
  result.placeYesOrder = primary.yes.gas;
  result.placeNoOrder = primary.no.gas;
  result.partialFill = await gas(f.book.matchOrders(primary.yes.id, primary.no.id, 7n));
  result.matchOrder = await gas(f.book.matchOrders(primary.yes.id, primary.no.id, 13n));

  const cancel = await place(f.book, f.carol, { market: auto.target, expiresAt: closesAt,
    price: 55, yes: true, buy: true, shares: 1n });
  result.cancelOrder = await gas(f.book.connect(f.carol).cancelOrder(cancel.id));

  const yesSell = await place(f.book, f.alice, { market: auto.target, expiresAt: closesAt,
    price: 70, yes: true, buy: false, shares: 2n });
  const yesBuy = await place(f.book, f.carol, { market: auto.target, expiresAt: closesAt,
    price: 70, yes: true, buy: true, shares: 2n });
  result.secondaryYesSale = await gas(f.book.matchOrders(yesSell.id, yesBuy.id, 2n));
  const noSell = await place(f.book, f.bob, { market: auto.target, expiresAt: closesAt,
    price: 65, yes: false, buy: false, shares: 2n });
  const noBuy = await place(f.book, f.dave, { market: auto.target, expiresAt: closesAt,
    price: 65, yes: false, buy: true, shares: 2n });
  result.secondaryNoSale = await gas(f.book.matchOrders(noSell.id, noBuy.id, 2n));

  for (const event of [yesEvent.market, noEvent.market, invalidEvent.market]) {
    const orders = await pair(f.book, event, f.alice, f.bob, 10n);
    await f.book.matchOrders(orders.yes.id, orders.no.id, 10n);
  }
  result.creatorFeeClaim = await gas(f.feeVault.connect(f.creator).claim());

  await network.provider.send('evm_setNextBlockTimestamp', [resolvesAt]);
  await network.provider.send('evm_mine');
  result.resolveAuto = await gas(auto.connect(f.carol).resolve());
  result.propose = await gas(yesEvent.market.connect(f.carol).propose(1, 'ipfs://benchmark-yes'));
  await noEvent.market.connect(f.carol).propose(1, 'ipfs://benchmark-proposed-yes');
  result.dispute = await gas(noEvent.market.connect(f.dave).dispute(2, 'ipfs://benchmark-disputed-no'));
  await invalidEvent.market.connect(f.carol).propose(1, 'ipfs://benchmark-proposed-yes');
  await invalidEvent.market.connect(f.dave).dispute(2, 'ipfs://benchmark-disputed-no');
  result.safeAdjudication = await gas(noEvent.market.connect(f.resolverSigner).adjudicate(2));
  await invalidEvent.market.connect(f.resolverSigner).adjudicate(3);
  await network.provider.send('evm_increaseTime', [DISPUTE_PERIOD]);
  await network.provider.send('evm_mine');
  result.finalizeUndisputed = await gas(yesEvent.market.finalize());
  result.redeemYes = await gas(yesEvent.market.connect(f.alice).redeem(true, 10n));
  result.redeemNo = await gas(noEvent.market.connect(f.bob).redeem(false, 10n));
  result.redeemInvalidYes = await gas(invalidEvent.market.connect(f.alice).redeem(true, 10n));
  result.redeemInvalidNo = await gas(invalidEvent.market.connect(f.bob).redeem(false, 10n));

  assert.equal(await yesEvent.market.resolvedOutcome(), 1n);
  assert.equal(await noEvent.market.resolvedOutcome(), 2n);
  assert.equal(await invalidEvent.market.resolvedOutcome(), 3n);
  const output = { mode: process.env.BASELINE_SNAPSHOT === '1' ? 'current-architecture' : 'clone-candidate',
    gas: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.toString()])), broadcast: false };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(process.env.BENCHMARK_OUTPUT || 'reports/runtime-benchmark.json', JSON.stringify(output, null, 2) + '\n');
  console.log(`Runtime benchmark complete: ${output.mode}`);
}

main().catch(error => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
