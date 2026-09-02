const test = require('node:test');
const assert = require('node:assert/strict');

const START = 51943083;
const addr = digit => `0x${String(digit).repeat(40)}`;
const hash = digit => `0x${String(digit).repeat(64)}`;

class MemoryStore {
  constructor() { this.tables = new Map(); }
  table(name) { if (!this.tables.has(name)) this.tables.set(name, []); return this.tables.get(name); }
  async state(chain) { return this.table('indexer_state').find(row => row.chain_id === chain) || null; }
  async markets(chain) { return this.table('markets').filter(row => row.chain_id === chain).map(row => row.address); }
  async orders(chain, ids) { return this.table('orders').filter(row => row.chain_id === chain && ids.includes(String(row.order_id))); }
  async upsert(name, rows, conflicts) {
    const keys = conflicts.split(','); const table = this.table(name);
    for (const row of rows) {
      const index = table.findIndex(current => keys.every(key => String(current[key]) === String(row[key])));
      if (index < 0) table.push(structuredClone(row)); else table[index] = { ...table[index], ...structuredClone(row) };
    }
  }
  async rpc(name, args) {
    if (name === 'rollback_one_shot_from_block') {
      for (const [tableName, rows] of this.tables) {
        if (tableName === 'indexer_state') continue;
        this.tables.set(tableName, rows.filter(row => Number(row.block_number ?? row.created_block ?? -1) < args.p_from_block));
      }
      const state = await this.state(args.p_chain_id); state.last_indexed_block = args.p_from_block-1; state.last_indexed_block_hash = null;
    }
    if (name === 'rebuild_one_shot_derived') {
      const orders = new Map();
      for (const event of this.table('order_events').sort((a,b) => a.block_number-b.block_number || a.log_index-b.log_index)) {
        if (event.event_type === 'placed') orders.set(String(event.order_id), { chain_id: event.chain_id,
          order_id: String(event.order_id), market_address: event.market_address, owner: event.wallet,
          yes: event.payload.yes, buy: event.payload.buy, price: event.payload.price,
          shares: event.payload.shares, remaining: event.payload.shares,
          expires_at: new Date(event.payload.expiresAt*1000).toISOString() });
        if (event.event_type === 'cancelled') orders.get(String(event.order_id)).remaining = '0';
        if (event.event_type === 'matched') for (const id of [event.order_id,event.secondary_order_id]) {
          const order = orders.get(String(id)); order.remaining = (BigInt(order.remaining)-BigInt(event.payload.shares)).toString();
        }
      }
      this.tables.set('orders',[...orders.values()]);
    }
  }
}

class FakeProvider {
  constructor(logs, blocks, head) { this.logs=logs; this.blocks=blocks; this.head=head; this.logFilters=[]; }
  async getBlockNumber() { return this.head; }
  async getBlock(number) { return this.blocks.get(Number(number)) || null; }
  async getLogs(filter) {
    this.logFilters.push(filter);
    const addresses = new Set((Array.isArray(filter.address) ? filter.address : [filter.address]).map(value => value.toLowerCase()));
    return this.logs.filter(log => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock &&
      addresses.has(log.address.toLowerCase()) && filter.topics[0].includes(log.topics[0]));
  }
}

test('historical indexing is resumable, idempotent, and repairs a short reorg', async () => {
  const [{ Interface }, constants, core] = await Promise.all([
    import('ethers'), import('../supabase/functions/_shared/constants.mjs'), import('../supabase/functions/_shared/indexer-core.mjs')
  ]);
  const factory = new Interface(constants.FACTORY_ABI), book = new Interface(constants.ORDER_BOOK_ABI), market = new Interface(constants.MARKET_ABI);
  const marketAddress=addr(1), alice=addr(2), bob=addr(3);
  const blocks = new Map(Array.from({length:6},(_,i) => [START+i,{number:START+i,hash:hash(i+1),timestamp:1900000000+i}]));
  let nonce=1;
  const log = (iface,name,values,address,blockNumber,index=0) => {
    const encoded=iface.encodeEventLog(iface.getEvent(name),values);
    return {address,topics:encoded.topics,data:encoded.data,blockNumber,blockHash:blocks.get(blockNumber).hash,
      transactionHash:hash((nonce++%8)+1),index};
  };
  const logs = [
    log(factory,'MarketCreated',[marketAddress,alice,0,hash(9)],constants.FACTORY,START),
    log(book,'OrderPlaced',[1,marketAddress,alice,true,true,60,10,1900001000],constants.ORDER_BOOK,START+1),
    log(book,'OrderPlaced',[2,marketAddress,bob,false,true,40,10,1900001000],constants.ORDER_BOOK,START+2),
    log(book,'OrdersMatched',[1,2,marketAddress,3,60,3000000,true,1900000003],constants.ORDER_BOOK,START+3),
    log(market,'Redeemed',[alice,true,1,1000000],marketAddress,START+4)
  ];
  const provider = new FakeProvider(logs,blocks,START+5), store = new MemoryStore();
  const snapshot = async (_provider,address,event,block) => ({chain_id:4663,address:address.toLowerCase(),factory_index:'0',
    creator:alice.toLowerCase(),collateral_vault:addr(4),question:'Will it happen?',yes_definition:'Yes',no_definition:'No',
    category:'Test',resolution_rules:'Objective',primary_source:'https://example.com',secondary_source:'',metadata_uri:'',
    metadata_hash:hash(9),closes_at:new Date(1900001000*1000).toISOString(),resolves_at:new Date(1900002000*1000).toISOString(),
    created_block:event.log.blockNumber,created_block_hash:event.log.blockHash,created_tx_hash:event.log.transactionHash,
    created_log_index:event.log.index,created_at:new Date(block.timestamp*1000).toISOString(),updated_at:new Date().toISOString()});
  let result;
  do { result=await core.runIndexer({provider,store,confirmations:1,batchSize:2,reorgDepth:64,loadMarketSnapshot:snapshot}); }
  while(result.status !== 'caught_up');
  assert.equal(store.table('markets').length,1); assert.equal(store.table('trades').length,1);
  assert.equal(store.table('indexed_logs').length,5); assert.equal(store.table('orders').find(row => row.order_id === '1').remaining,'7');
  assert.ok(provider.logFilters.every(filter => filter.toBlock-filter.fromBlock < 10), 'RPC log ranges stay within the provider limit');
  const counts = Object.fromEntries([...store.tables].map(([name,rows]) => [name,rows.length]));
  result=await core.runIndexer({provider,store,confirmations:1,batchSize:2,reorgDepth:64,loadMarketSnapshot:snapshot});
  assert.equal(result.processedLogs,0);
  assert.deepEqual(Object.fromEntries([...store.tables].map(([name,rows]) => [name,rows.length])),counts);

  blocks.set(START+4,{number:START+4,hash:hash(8),timestamp:1900000004});
  logs.splice(3,1,log(book,'OrdersMatched',[1,2,marketAddress,4,60,4000000,true,1900000003],constants.ORDER_BOOK,START+3));
  for (const item of logs) item.blockHash=blocks.get(item.blockNumber).hash;
  do { result=await core.runIndexer({provider,store,confirmations:1,batchSize:2,reorgDepth:64,loadMarketSnapshot:snapshot}); }
  while(result.status !== 'caught_up');
  assert.equal(store.table('trades').length,1); assert.equal(store.table('trades')[0].shares,'4');
  assert.equal(store.table('orders').find(row => row.order_id === '1').remaining,'6');
});
