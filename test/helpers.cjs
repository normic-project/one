const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const UNIT = 1_000_000n;
const FEE = ethers.parseEther('0.0006');

const eventMetadata = (overrides = {}) => ({
  question: 'Will the public launch occur before the stated resolution date?',
  yesOutcome: 'The product is publicly available before the resolution timestamp.',
  noOutcome: 'The product is not publicly available before the resolution timestamp.',
  category: 'Tech',
  rules: 'Resolve YES only if the primary source publishes a generally available launch before the immutable resolution timestamp. Resolve NO if it does not. Resolve INVALID only when these rules cannot determine an outcome.',
  primarySource: 'https://example.com/company/newsroom',
  secondarySource: 'https://example.com/product',
  metadataURI: 'ipfs://bafybeigdyrzt',
  ...overrides
});

async function deployMarketImplementation(deployer, token, resolverMultisig) {
  const nonce = await deployer.getNonce();
  const predictedFactory = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const predictedOrderBook = ethers.getCreateAddress({ from: predictedFactory, nonce: 2 });
  const eventMarketImplementation = await ethers.deployContract('EventMarket',
    [token, predictedOrderBook, resolverMultisig], deployer);
  return { eventMarketImplementation, predictedFactory, predictedOrderBook };
}

async function fixture(tokenName = 'MockUSDG', treasuryOverride) {
  const [deployer, treasury, resolverSigner, creator, alice, bob, carol, dave] = await ethers.getSigners();
  const token = await ethers.deployContract(tokenName);
  const implementation = await deployMarketImplementation(deployer, token.target, resolverSigner.address);
  const factory = await ethers.deployContract('MarketFactory', [token.target, treasuryOverride || treasury.address,
    resolverSigner.address, implementation.eventMarketImplementation.target]);
  if (factory.target.toLowerCase() !== implementation.predictedFactory.toLowerCase() ||
      (await factory.orderBook()).toLowerCase() !== implementation.predictedOrderBook.toLowerCase())
    throw new Error('factory or order book prediction mismatch');
  const book = await ethers.getContractAt('OrderBook', await factory.orderBook());
  const feeVault = await ethers.getContractAt('FeeVault', await factory.feeVault());
  const now = await time.latest();
  const eventTimes = { closesAt: now + 86_400, resolvesAt: now + 86_500 };
  await factory.connect(creator).createEventMarket(eventTimes.closesAt, eventTimes.resolvesAt, eventMetadata(), { value: FEE });
  const market = await ethers.getContractAt('EventMarket', await factory.markets(0));
  const collateral = await ethers.getContractAt('CollateralVault', await market.collateralVault());
  const traders = [creator, alice, bob, carol, dave];
  for (const trader of traders) {
    await token.mint(trader.address, 10_000_000n * UNIT);
    await token.connect(trader).approve(book.target, ethers.MaxUint256);
  }

  async function place(owner, yes, buy, price, shares, options = {}) {
    const targetMarket = options.market || market.target;
    const expiry = options.expiresAt || Number(await (await ethers.getContractAt('PredictionMarket', targetMarket)).closesAt());
    const id = await book.nextOrderId();
    await book.connect(owner).placeOrder({ market: targetMarket, expiresAt: expiry, price, yes, buy, shares });
    return id;
  }
  async function pair(shares = 100n, price = 60, yesOwner = alice, noOwner = bob, targetMarket = market.target) {
    const y = await place(yesOwner, true, true, price, shares, { market: targetMarket });
    const n = await place(noOwner, false, true, 100 - price, shares, { market: targetMarket });
    await book.matchOrders(y, n, shares);
    return [y, n];
  }
  async function createEvent(owner = creator, metadata = eventMetadata(), times = {}) {
    const latest = await time.latest();
    const closesAt = times.closesAt || latest + 3600;
    const resolvesAt = times.resolvesAt || latest + 3700;
    await factory.connect(owner).createEventMarket(closesAt, resolvesAt, metadata, { value: FEE });
    const address = await factory.markets((await factory.marketCount()) - 1n);
    return { market: await ethers.getContractAt('EventMarket', address), closesAt, resolvesAt, metadata };
  }
  return { deployer, treasury, resolverSigner, creator, alice, bob, carol, dave, traders, token,
    eventMarketImplementation: implementation.eventMarketImplementation,
    factory, book, feeVault, market, collateral, eventTimes, place, pair, createEvent };
}

module.exports = { fixture, eventMetadata, deployMarketImplementation, UNIT, FEE };
