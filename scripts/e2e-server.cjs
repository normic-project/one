// Isolated browser integration harness. In-memory EVM only. No network fork or real credentials.
const http = require('node:http');
const { ethers, network, artifacts } = require('hardhat');
const canonical = require('../config/mainnet.json');

const UNIT = 1_000_000n;
const FEE = ethers.parseEther('0.0006');
const BOND = 25n * UNIT;
const PERIOD = 86_400;
const metadata = (suffix, category = 'Tech') => ({
  question: `Will the public product ${suffix} launch before the stated date?`,
  yesOutcome: 'The product is publicly available before the resolution timestamp.',
  noOutcome: 'The product is not publicly available before the resolution timestamp.',
  category,
  rules: 'Use the official newsroom as the primary source. YES requires a public general-availability announcement before the cutoff. NO applies otherwise. INVALID applies only if these terms cannot determine an outcome.',
  primarySource: 'https://example.com/official-newsroom',
  secondarySource: 'https://example.com/product-status',
  metadataURI: `ipfs://fixture-${suffix}`
});

async function main() {
  if (process.env.SIMULATE_FORK === '1') throw new Error('Browser tests must not use a network fork.');
  const signers = await ethers.getSigners();
  const mockToken = await artifacts.readArtifact('MockUSDG');
  const mockWeth = await artifacts.readArtifact('MockWETH');
  await network.provider.send('hardhat_setCode', [canonical.usdg, mockToken.deployedBytecode]);
  await network.provider.send('hardhat_setCode', [canonical.weth, mockWeth.deployedBytecode]);
  const token = await ethers.getContractAt('MockUSDG', canonical.usdg);
  const [token0, token1] = BigInt(canonical.weth) < BigInt(canonical.usdg)
    ? [canonical.weth, canonical.usdg] : [canonical.usdg, canonical.weth];
  const ratio = token0.toLowerCase() === canonical.weth.toLowerCase() ? 3000e6 / 1e18 : 1e18 / 3000e6;
  const tick = Math.floor(Math.log(ratio) / Math.log(1.0001));
  const mockPool = await ethers.deployContract('MockV3Pool', [token0, token1, 100, tick]);
  await network.provider.send('hardhat_setCode', [canonical.wethUsdgPool, await ethers.provider.getCode(mockPool.target)]);
  const pool = await ethers.getContractAt('MockV3Pool', canonical.wethUsdgPool);
  await pool.setAverageTick(tick);
  await pool.setHistoryAvailable(true);

  const autoResolver = await ethers.deployContract('UniswapTwapResolver',
    [canonical.weth, canonical.usdg, canonical.wethUsdgPool, canonical.twapWindow]);
  const nonce = await signers[0].getNonce();
  const predictedFactory = ethers.getCreateAddress({ from: signers[0].address, nonce: nonce + 2 });
  const predictedOrderBook = ethers.getCreateAddress({ from: predictedFactory, nonce: 2 });
  const autoMarketImplementation = await ethers.deployContract('AutoMarket',
    [canonical.usdg, predictedOrderBook, autoResolver.target]);
  const eventMarketImplementation = await ethers.deployContract('EventMarket',
    [canonical.usdg, predictedOrderBook, signers[7].address, BOND, PERIOD]);
  const factory = await ethers.deployContract('MarketFactory', [canonical.usdg, signers[1].address, autoResolver.target,
    signers[7].address, BOND, PERIOD, autoMarketImplementation.target, eventMarketImplementation.target]);
  const book = await ethers.getContractAt('OrderBook', await factory.orderBook());
  for (const signer of signers.slice(2, 8)) {
    await token.mint(signer.address, 100_000n * UNIT);
    await token.connect(signer).approve(book.target, ethers.MaxUint256);
  }

  async function createEvent(owner, closesAt, resolvesAt, data) {
    await factory.connect(owner).createEventMarket(closesAt, resolvesAt, data, { value: FEE });
    const address = await factory.markets((await factory.marketCount()) - 1n);
    const market = await ethers.getContractAt('EventMarket', address);
    for (const signer of signers.slice(2, 8)) await token.connect(signer).approve(address, ethers.MaxUint256);
    return market;
  }
  async function pair(market, yes = signers[3], no = signers[4], shares = 100) {
    const close = await market.closesAt();
    const first = await book.nextOrderId();
    await book.connect(yes).placeOrder({ market: market.target, expiresAt: close, price: 60, yes: true, buy: true, shares });
    const second = await book.nextOrderId();
    await book.connect(no).placeOrder({ market: market.target, expiresAt: close, price: 40, yes: false, buy: true, shares });
    await book.matchOrders(first, second, shares);
  }

  const initial = (await ethers.provider.getBlock('latest')).timestamp;
  const proposed = await createEvent(signers[2], initial + 120, initial + 180, metadata('Alpha', 'Politics'));
  const disputed = await createEvent(signers[2], initial + 120, initial + 180, metadata('Beta', 'Sports'));
  const invalid = await createEvent(signers[2], initial + 120, initial + 180, metadata('Gamma', 'Culture'));
  const invalidSecond = await createEvent(signers[2], initial + 120, initial + 180, metadata('Eta', 'Other'));
  const resolvedYes = await createEvent(signers[2], initial + 120, initial + 180, metadata('Epsilon', 'World'));
  const resolvedNo = await createEvent(signers[2], initial + 120, initial + 180, metadata('Zeta', 'Entertainment'));
  const disputeActionDesktop = await createEvent(signers[2], initial + 120, initial + 180, metadata('Iota', 'Politics'));
  const disputeActionMobile = await createEvent(signers[2], initial + 120, initial + 180, metadata('Kappa', 'Sports'));
  await pair(invalid);
  await pair(invalidSecond);
  await network.provider.send('evm_setNextBlockTimestamp', [initial + 180]);
  await network.provider.send('evm_mine');
  await proposed.connect(signers[5]).propose(1, 'ipfs://proposal-yes');
  await disputed.connect(signers[5]).propose(1, 'ipfs://proposal-yes');
  await disputed.connect(signers[6]).dispute(2, 'ipfs://dispute-no');
  await invalid.connect(signers[5]).propose(1, 'ipfs://proposal-yes');
  await invalid.connect(signers[6]).dispute(2, 'ipfs://dispute-no');
  await invalid.connect(signers[7]).adjudicate(3);
  await invalidSecond.connect(signers[5]).propose(1, 'ipfs://proposal-yes');
  await invalidSecond.connect(signers[6]).dispute(2, 'ipfs://dispute-no');
  await invalidSecond.connect(signers[7]).adjudicate(3);
  await resolvedYes.connect(signers[5]).propose(2, 'ipfs://proposal-no');
  await resolvedYes.connect(signers[6]).dispute(1, 'ipfs://dispute-yes');
  await resolvedYes.connect(signers[7]).adjudicate(1);
  await resolvedNo.connect(signers[5]).propose(1, 'ipfs://proposal-yes');
  await resolvedNo.connect(signers[6]).dispute(2, 'ipfs://dispute-no');
  await resolvedNo.connect(signers[7]).adjudicate(2);
  await disputeActionDesktop.connect(signers[5]).propose(1, 'ipfs://proposal-yes');
  await disputeActionMobile.connect(signers[5]).propose(1, 'ipfs://proposal-yes');

  const proposalBase = (await ethers.provider.getBlock('latest')).timestamp;
  const proposalReadyDesktop = await createEvent(signers[2], proposalBase + 120, proposalBase + 180,
    metadata('Theta', 'Companies'));
  const proposalReadyMobile = await createEvent(signers[2], proposalBase + 120, proposalBase + 180,
    metadata('Lambda', 'Tech'));
  await network.provider.send('evm_setNextBlockTimestamp', [proposalBase + 180]);
  await network.provider.send('evm_mine');
  const current = (await ethers.provider.getBlock('latest')).timestamp;
  const open = await createEvent(signers[2], current + 86_400, current + 86_500, metadata('Delta', 'Tech'));
  const unsafeSource = await createEvent(signers[2], current + 86_400, current + 86_500,
    { ...metadata('Mu', 'Other'), primarySource: 'javascript:alert(document.domain)' });
  await pair(open);
  await factory.connect(signers[2]).createAutoMarket({ threshold: 3000n * UNIT, closesAt: current + 86_400,
    resolvesAt: current + 86_500, condition: 0 }, { value: FEE });
  const automatic = await factory.markets((await factory.marketCount()) - 1n);
  await token.connect(signers[3]).approve(book.target, 0);

  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5174');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.url === '/fixture') {
      response.end(JSON.stringify({ account: signers[3].address, creator: signers[2].address, market: open.target,
        automatic, proposalReadyDesktop: proposalReadyDesktop.target, proposalReadyMobile: proposalReadyMobile.target,
        disputeActionDesktop: disputeActionDesktop.target, disputeActionMobile: disputeActionMobile.target,
        proposed: proposed.target, disputed: disputed.target, invalid: invalid.target, unsafeSource: unsafeSource.target,
        resolvedYes: resolvedYes.target, resolvedNo: resolvedNo.target, factory: factory.target }));
      return;
    }
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 1_000_000) { response.writeHead(413); response.end(); return; } }
    async function handle(item) {
      try { return { jsonrpc: '2.0', id: item.id, result: await network.provider.request({ method: item.method, params: item.params || [] }) }; }
      catch (e) { return { jsonrpc: '2.0', id: item.id, error: { code: e.code || -32603, message: e.message, data: e.data } }; }
    }
    try { const payload = JSON.parse(body); response.end(JSON.stringify(Array.isArray(payload) ? await Promise.all(payload.map(handle)) : await handle(payload))); }
    catch { response.writeHead(400); response.end(JSON.stringify({ error: 'Invalid JSON-RPC' })); }
  });
  await new Promise(resolve => server.listen(8547, '127.0.0.1', resolve));
  process.env.VITE_RH_RPC_URL = 'http://127.0.0.1:8547';
  process.env.VITE_FACTORY_ADDRESS = factory.target;
  process.env.VITE_DEPLOYMENT_BLOCK = '1';
  const viteApi = await import('vite');
  let vite;
  if (process.env.ONE_SHOT_AUDIT_VERIFY === '1') {
    await viteApi.build({ mode: 'e2e', configLoader: 'runner' });
    vite = await viteApi.preview({ mode: 'e2e', configLoader: 'runner',
      preview: { host: '127.0.0.1', port: 5174, strictPort: true } });
  } else {
    vite = await viteApi.createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true }, mode: 'e2e' });
    await vite.listen();
  }
  console.log('Isolated general-market browser fixture ready on 127.0.0.1:5174.');
  async function close() { await vite.close(); server.close(); process.exit(0); }
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
main().catch(error => { console.error(error.message); process.exit(1); });
