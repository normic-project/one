const fs = require('node:fs');
const { ethers, network } = require('hardhat');
const { fixture, eventMetadata, FEE } = require('../test/helpers.cjs');

async function gas(tx) { return (await (await tx).wait()).gasUsed; }
async function create(factory, owner, closesAt, resolvesAt, suffix) {
  const tx = await factory.connect(owner).createEventMarket(closesAt, resolvesAt, eventMetadata({
    question: `Will benchmark event ${suffix} occur?`, primarySource: `https://example.com/${suffix}`
  }), { value: FEE });
  const receipt = await tx.wait();
  return { market: await ethers.getContractAt('EventMarket',
    await factory.markets((await factory.marketCount()) - 1n)), gas: receipt.gasUsed };
}
async function place(book, signer, request) {
  const id = await book.nextOrderId();
  return { id, gas: await gas(book.connect(signer).placeOrder(request)) };
}
async function main() {
  const f = await fixture();
  const latest = Number((await ethers.provider.getBlock('latest')).timestamp);
  const closesAt = latest + 600;
  const resolvesAt = latest + 700;
  const yesMarket = await create(f.factory, f.creator, closesAt, resolvesAt, 'yes');
  const noMarket = await create(f.factory, f.creator, closesAt, resolvesAt, 'no');
  const invalidMarket = await create(f.factory, f.creator, closesAt, resolvesAt, 'invalid');
  const result = { createEventMarket: yesMarket.gas };
  const yes = await place(f.book, f.alice, { market: yesMarket.market.target, expiresAt: closesAt,
    price: 60, yes: true, buy: true, shares: 20n });
  const no = await place(f.book, f.bob, { market: yesMarket.market.target, expiresAt: closesAt,
    price: 40, yes: false, buy: true, shares: 20n });
  result.placeYesOrder = yes.gas;
  result.placeNoOrder = no.gas;
  result.partialFill = await gas(f.book.matchOrders(yes.id, no.id, 7n));
  result.matchOrder = await gas(f.book.matchOrders(yes.id, no.id, 13n));
  const cancel = await place(f.book, f.carol, { market: yesMarket.market.target, expiresAt: closesAt,
    price: 55, yes: true, buy: true, shares: 1n });
  result.cancelOrder = await gas(f.book.connect(f.carol).cancelOrder(cancel.id));
  const yesSell = await place(f.book, f.alice, { market: yesMarket.market.target, expiresAt: closesAt,
    price: 70, yes: true, buy: false, shares: 2n });
  const yesBuy = await place(f.book, f.carol, { market: yesMarket.market.target, expiresAt: closesAt,
    price: 70, yes: true, buy: true, shares: 2n });
  result.secondaryYesSale = await gas(f.book.matchOrders(yesSell.id, yesBuy.id, 2n));
  const noSell = await place(f.book, f.bob, { market: yesMarket.market.target, expiresAt: closesAt,
    price: 65, yes: false, buy: false, shares: 2n });
  const noBuy = await place(f.book, f.dave, { market: yesMarket.market.target, expiresAt: closesAt,
    price: 65, yes: false, buy: true, shares: 2n });
  result.secondaryNoSale = await gas(f.book.matchOrders(noSell.id, noBuy.id, 2n));
  for (const market of [noMarket.market, invalidMarket.market]) {
    const a = await place(f.book, f.alice, { market: market.target, expiresAt: closesAt,
      price: 60, yes: true, buy: true, shares: 10n });
    const b = await place(f.book, f.bob, { market: market.target, expiresAt: closesAt,
      price: 40, yes: false, buy: true, shares: 10n });
    await f.book.matchOrders(a.id, b.id, 10n);
  }
  result.creatorFeeClaim = await gas(f.feeVault.connect(f.creator).claim());
  await network.provider.send('evm_setNextBlockTimestamp', [resolvesAt]);
  await network.provider.send('evm_mine');
  result.resolveYes = await gas(yesMarket.market.connect(f.resolverSigner).resolve(1));
  result.resolveNo = await gas(noMarket.market.connect(f.resolverSigner).resolve(2));
  result.resolveInvalid = await gas(invalidMarket.market.connect(f.resolverSigner).resolve(3));
  result.redeemYes = await gas(yesMarket.market.connect(f.alice).redeem(true, 18n));
  result.redeemNo = await gas(noMarket.market.connect(f.bob).redeem(false, 10n));
  result.redeemInvalidYes = await gas(invalidMarket.market.connect(f.alice).redeem(true, 10n));
  result.redeemInvalidNo = await gas(invalidMarket.market.connect(f.bob).redeem(false, 10n));
  const output = { mode: 'event-only-architecture',
    gas: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.toString()])), broadcast: false };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/runtime-benchmark.json', JSON.stringify(output, null, 2) + '\n');
  console.log('Runtime benchmark complete: event-only-architecture');
}
main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
