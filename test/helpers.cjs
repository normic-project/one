const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const UNIT = 1_000_000n;
const FEE = ethers.parseEther('0.0006');
const BOND = 25n * UNIT;
const DISPUTE_PERIOD = 86_400;

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

async function deployMarketImplementations(deployer, token, autoResolver, resolverMultisig) {
  const nonce = await deployer.getNonce();
  const predictedFactory = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 2 });
  const predictedOrderBook = ethers.getCreateAddress({ from: predictedFactory, nonce: 2 });
  const autoMarketImplementation = await ethers.deployContract('AutoMarket',
    [token, predictedOrderBook, autoResolver], deployer);
  const eventMarketImplementation = await ethers.deployContract('EventMarket',
    [token, predictedOrderBook, resolverMultisig, BOND, DISPUTE_PERIOD], deployer);
  return { autoMarketImplementation, eventMarketImplementation, predictedFactory, predictedOrderBook };
}

async function fixture(tokenName = 'MockUSDG', treasuryOverride) {
  const [deployer, treasury, resolverSigner, creator, alice, bob, carol, dave] = await ethers.getSigners();
  const token = await ethers.deployContract(tokenName);
  const weth = await ethers.deployContract('MockWETH');
  const [token0, token1] = BigInt(weth.target) < BigInt(token.target)
    ? [weth.target, token.target] : [token.target, weth.target];
  const rawRatio = token0.toLowerCase() === weth.target.toLowerCase() ? 3000e6 / 1e18 : 1e18 / 3000e6;
  const tick = Math.floor(Math.log(rawRatio) / Math.log(1.0001));
  const pool = await ethers.deployContract('MockV3Pool', [token0, token1, 3000, tick]);
  const autoResolver = await ethers.deployContract('UniswapTwapResolver', [weth.target, token.target, pool.target, 3600]);
  const implementations = await deployMarketImplementations(deployer, token.target, autoResolver.target, resolverSigner.address);
  const factory = await ethers.deployContract('MarketFactory', [token.target, treasuryOverride || treasury.address,
    autoResolver.target, resolverSigner.address, BOND, DISPUTE_PERIOD,
    implementations.autoMarketImplementation.target, implementations.eventMarketImplementation.target]);
  if (factory.target.toLowerCase() !== implementations.predictedFactory.toLowerCase() ||
      (await factory.orderBook()).toLowerCase() !== implementations.predictedOrderBook.toLowerCase())
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
    await token.connect(trader).approve(market.target, ethers.MaxUint256);
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
    const event = await ethers.getContractAt('EventMarket', address);
    for (const trader of traders) await token.connect(trader).approve(address, ethers.MaxUint256);
    return { market: event, closesAt, resolvesAt, metadata };
  }
  async function createAuto(owner = creator, overrides = {}) {
    const latest = await time.latest();
    const terms = { threshold: 3000n * UNIT, closesAt: latest + 3600, resolvesAt: latest + 3700,
      condition: 0, ...overrides };
    await factory.connect(owner).createAutoMarket(terms, { value: FEE });
    const address = await factory.markets((await factory.marketCount()) - 1n);
    return { market: await ethers.getContractAt('AutoMarket', address), terms };
  }
  return { deployer, treasury, resolverSigner, creator, alice, bob, carol, dave, traders, token, weth, pool,
    autoResolver, autoMarketImplementation: implementations.autoMarketImplementation,
    eventMarketImplementation: implementations.eventMarketImplementation,
    factory, book, feeVault, market, collateral, eventTimes, place, pair, createEvent, createAuto };
}

module.exports = { fixture, eventMetadata, deployMarketImplementations, UNIT, FEE, BOND, DISPUTE_PERIOD };
