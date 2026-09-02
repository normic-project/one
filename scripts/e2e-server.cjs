// Isolated browser integration harness. In-memory EVM only. No network fork or real credentials.
const http = require('node:http');
const { ethers, network, artifacts } = require('hardhat');
const canonical = require('../config/mainnet.json');

const UNIT = 1_000_000n;
const FEE = ethers.parseEther('0.0006');
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
  await network.provider.send('hardhat_setCode', [canonical.usdg, mockToken.deployedBytecode]);
  const token = await ethers.getContractAt('MockUSDG', canonical.usdg);
  const nonce = await signers[0].getNonce();
  const predictedFactory = ethers.getCreateAddress({ from: signers[0].address, nonce: nonce + 1 });
  const predictedOrderBook = ethers.getCreateAddress({ from: predictedFactory, nonce: 2 });
  const implementation = await ethers.deployContract('EventMarket', [canonical.usdg, predictedOrderBook, signers[7].address]);
  const factory = await ethers.deployContract('MarketFactory',
    [canonical.usdg, signers[1].address, signers[7].address, implementation.target]);
  const book = await ethers.getContractAt('OrderBook', await factory.orderBook());
  for (const signer of signers.slice(2, 8)) {
    await token.mint(signer.address, 100_000n * UNIT);
    await token.connect(signer).approve(book.target, ethers.MaxUint256);
  }

  async function create(owner, closesAt, resolvesAt, data) {
    await factory.connect(owner).createEventMarket(closesAt, resolvesAt, data, { value: FEE });
    return ethers.getContractAt('EventMarket', await factory.markets((await factory.marketCount()) - 1n));
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
  const pending = await create(signers[2], initial + 120, initial + 180, metadata('Alpha', 'Politics'));
  const invalid = await create(signers[2], initial + 120, initial + 180, metadata('Gamma', 'Culture'));
  const invalidSecond = await create(signers[2], initial + 120, initial + 180, metadata('Eta', 'Other'));
  const resolvedYes = await create(signers[2], initial + 120, initial + 180, metadata('Epsilon', 'World'));
  const resolvedNo = await create(signers[2], initial + 120, initial + 180, metadata('Zeta', 'Entertainment'));
  await pair(invalid);
  await pair(invalidSecond);
  await network.provider.send('evm_setNextBlockTimestamp', [initial + 180]);
  await network.provider.send('evm_mine');
  await invalid.connect(signers[7]).resolve(3);
  await invalidSecond.connect(signers[7]).resolve(3);
  await resolvedYes.connect(signers[7]).resolve(1);
  await resolvedNo.connect(signers[7]).resolve(2);

  const current = (await ethers.provider.getBlock('latest')).timestamp;
  const open = await create(signers[2], current + 86_400, current + 86_500, metadata('Delta', 'Tech'));
  const unsafeSource = await create(signers[2], current + 86_400, current + 86_500,
    { ...metadata('Mu', 'Other'), primarySource: 'javascript:alert(document.domain)' });
  await pair(open);
  await token.connect(signers[3]).approve(book.target, 0);

  async function marketData(address) {
    const market = await ethers.getContractAt('EventMarket', address);
    const [data, creator, state, outcome, volume, yesPrice, vaultAddress, metadataHash, closesAt, resolvesAt, resolverMultisig] = await Promise.all([
      market.metadata(), market.creator(), market.marketState(), market.resolvedOutcome(), market.volume(), market.lastYesPrice(),
      market.collateralVault(), market.metadataHash(), market.closesAt(), market.resolvesAt(), market.resolverMultisig()
    ]);
    const vault = await ethers.getContractAt('CollateralVault', vaultAddress);
    return { address, creator, question:data.question, yesOutcome:data.yesOutcome, noOutcome:data.noOutcome,
      category:data.category, rules:data.rules, primarySource:data.primarySource, secondarySource:data.secondarySource,
      metadataURI:data.metadataURI, closesAt:Number(closesAt), resolvesAt:Number(resolvesAt), state:Number(state),
      outcome:Number(outcome), resolved:outcome !== 0n, yesWins:outcome === 1n, volume:volume.toString(),
      yesPrice:Number(yesPrice), locked:(await vault.locked()).toString(), metadataHash, resolverMultisig,
      chainTimestamp:(await ethers.provider.getBlock('latest')).timestamp };
  }
  async function allMarkets() {
    const count=Number(await factory.marketCount()), values=[];
    for (let index=count-1; index>=0; index-=1) values.push(await marketData(await factory.markets(index)));
    return values;
  }
  async function orderData(id) {
    const value=await book.orders(id);
    return {id:id.toString(),market:value.market,owner:value.owner,expiresAt:Number(value.expiresAt),price:Number(value.price),
      yes:value.yes,buy:value.buy,remaining:value.remaining.toString(),status:value.remaining ? 'open':'filled'};
  }
  async function orderList(value,user) {
    const count=Number(await book[user?'userOrderCount':'marketOrderCount'](value));
    const ids=await book[user?'userOrderIds':'marketOrderIds'](value,0,count);
    return Promise.all(ids.map(orderData));
  }
  async function tradeList(address) {
    const events=await book.queryFilter(book.filters.OrdersMatched(null,null,address));
    return events.map(event => ({firstId:event.args.firstId.toString(),secondId:event.args.secondId.toString(),
      market:event.args.market,firstOwner:ethers.ZeroAddress,secondOwner:ethers.ZeroAddress,shares:event.args.shares.toString(),
      yesPrice:Number(event.args.yesPrice),notional:event.args.notional.toString(),mint:event.args.mint,
      timestamp:Number(event.args.timestamp),hash:event.transactionHash,blockNumber:event.blockNumber,index:event.index}));
  }
  async function api(url) {
    const path=url.pathname.split('/').filter(Boolean), address=path[2];
    if (url.pathname === '/api/markets') {
      let values=await allMarkets(); const query=(url.searchParams.get('q')||'').toLowerCase();
      if(query) values=values.filter(item => `${item.question} ${item.category} ${item.yesOutcome} ${item.noOutcome}`.toLowerCase().includes(query));
      if(url.searchParams.get('category')) values=values.filter(item => item.category === url.searchParams.get('category'));
      if(url.searchParams.get('status') === 'resolved') values=values.filter(item => item.resolved);
      if(url.searchParams.get('status') === 'open') values=values.filter(item => !item.resolved);
      if(url.searchParams.get('sort') === 'closing') values.sort((a,b)=>a.closesAt-b.closesAt);
      const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||24);
      return {markets:values.slice(offset,offset+limit),total:values.length};
    }
    if (url.pathname === '/api/categories') return {categories:[...new Set((await allMarkets()).map(value => value.category))].sort()};
    if(path[0] === 'api' && path[1] === 'markets' && address) {
      if(path[3] === 'trades') return {trades:await tradeList(address),total:(await tradeList(address)).length};
      if(path[3] === 'prices') { const trades=await tradeList(address); return {prices:trades.map(value => ({...value,noPrice:100-value.yesPrice})),total:trades.length}; }
      if(path[3] === 'orders') { const orders=await orderList(address,false); return {orders,total:orders.length}; }
      return marketData(address);
    }
    if(path[0] === 'api' && path[1] === 'wallet' && address) {
      if(path[3] === 'orders') { const orders=await orderList(address,true); return {orders,total:orders.length}; }
      if(path[3] === 'activity') return {activity:[],total:0};
      if(path[3] === 'positions') {
        const values=[];
        for (const market of await allMarkets()) for (const yes of [true,false]) {
          const shares=await (await ethers.getContractAt('EventMarket',market.address)).sharesOf(address,yes);
          if(shares) values.push({market,yes,indexedShares:shares.toString(),available:shares.toString(),netInvestment:'0',lastActivityAt:new Date().toISOString()});
        }
        return {positions:values,total:values.length};
      }
      const created=(await allMarkets()).filter(value => value.creator.toLowerCase() === address.toLowerCase());
      const earnedByMarket={}; for(const value of created) earnedByMarket[value.address]=(await (await ethers.getContractAt('FeeVault',await factory.feeVault())).earnedByMarket(value.address)).toString();
      return {wallet:address,claimableCreatorFees:(await (await ethers.getContractAt('FeeVault',await factory.feeVault())).claimable(address)).toString(),
        marketsCreated:created,earnedByMarket,trades:[],claims:[]};
    }
    if(url.pathname === '/api/health') return {status:'ok',chainId:31337,lastIndexedBlock:await ethers.provider.getBlockNumber()};
    throw Object.assign(new Error('Not found'),{status:404});
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5174');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method === 'POST' && request.url === '/__shutdown') {
      response.writeHead(204); response.end(() => void close()); return;
    }
    if (request.url === '/fixture') {
      response.end(JSON.stringify({ account: signers[3].address, emptyAccount: signers[6].address,
        creatorAccount: signers[2].address, market: open.target, pending: pending.target,
        invalid: invalid.target, invalidSecond: invalidSecond.target, unsafeSource: unsafeSource.target,
        resolvedYes: resolvedYes.target, resolvedNo: resolvedNo.target, factory: factory.target }));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/')) {
      try { response.end(JSON.stringify(await api(new URL(request.url,'http://127.0.0.1:8547')))); }
      catch(error) { response.writeHead(error.status||500); response.end(JSON.stringify({error:error.message})); }
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
  process.env.VITE_ORDER_BOOK_ADDRESS = book.target;
  process.env.VITE_FEE_VAULT_ADDRESS = await factory.feeVault();
  process.env.VITE_RESOLVER_SAFE_ADDRESS = signers[7].address;
  process.env.VITE_TREASURY_ADDRESS = signers[1].address;
  const viteApi = await import('vite');
  const proxy = { '/api': 'http://127.0.0.1:8547' };
  let vite;
  if (process.env.ONE_SHOT_AUDIT_VERIFY === '1') {
    await viteApi.build({ mode: 'e2e', configLoader: 'runner' });
    vite = await viteApi.preview({ mode: 'e2e', configLoader: 'runner',
      preview: { host: '127.0.0.1', port: 5174, strictPort: true, proxy } });
  } else {
    vite = await viteApi.createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy }, mode: 'e2e' });
    await vite.listen();
  }
  console.log('Isolated event-market browser fixture ready on 127.0.0.1:5174.');
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await vite.close();
    await new Promise(resolve => server.close(resolve));
    process.exit(0);
  }
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
main().catch(error => { console.error(error.message); process.exit(1); });
