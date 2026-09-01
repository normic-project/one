const test = require('node:test');
const assert = require('node:assert/strict');

const wallet = '0x2222222222222222222222222222222222222222';
const market = '0x1111111111111111111111111111111111111111';
const marketRow = { chain_id:4663,address:market,creator:wallet,question:'Will the API work?',yes_definition:'It works',
  no_definition:'It fails',category:'Technology',resolution_rules:'Objective result',primary_source:'https://example.com',
  secondary_source:'',metadata_uri:'',metadata_hash:`0x${'9'.repeat(64)}`,closes_at:'2030-01-01T00:00:00.000Z',
  resolves_at:'2030-01-02T00:00:00.000Z',created_at:'2026-09-01T00:00:00.000Z',factory_index:'0',outcome:0,
  volume_usdg:'3000000',last_yes_price:60,trade_count:1,unique_traders:2,trending_score:'7000000' };
const tables = {
  market_overview:[marketRow],
  market_price_history:[{chain_id:4663,market_address:market,traded_at:'2026-09-01T00:01:00.000Z',yes_price:60,
    no_price:40,shares:'3',notional:'3000000',tx_hash:`0x${'7'.repeat(64)}`,block_number:51943086,log_index:0}],
  trades:[{chain_id:4663,market_address:market,first_order_id:'1',second_order_id:'2',first_owner:wallet,
    second_owner:'0x3333333333333333333333333333333333333333',shares:'3',yes_price:60,notional:'3000000',mint:true,
    traded_at:'2026-09-01T00:01:00.000Z',tx_hash:`0x${'7'.repeat(64)}`,block_number:51943086,log_index:0}],
  redemptions_claims:[]
};

class Query {
  constructor(name) { this.name=name; this.rows=[...(tables[name]||[])]; this.wantCount=false; this.one=false; }
  select(_columns,options={}) { this.wantCount=options.count === 'exact'; return this; }
  eq(key,value) { this.rows=this.rows.filter(row => String(row[key]).toLowerCase() === String(value).toLowerCase()); return this; }
  gt(key,value) { this.rows=this.rows.filter(row => BigInt(row[key]) > BigInt(value)); return this; }
  or() { return this; }
  order(key,{ascending=true}={}) { this.rows.sort((a,b) => String(a[key]).localeCompare(String(b[key]))*(ascending?1:-1)); return this; }
  range(start,end) { this.slice=[start,end]; return this; }
  limit(count) { this.slice=[0,count-1]; return this; }
  maybeSingle() { this.one=true; return this; }
  single() { this.one=true; return this; }
  then(resolve) { const count=this.rows.length; const rows=this.slice?this.rows.slice(this.slice[0],this.slice[1]+1):this.rows;
    return Promise.resolve({data:this.one?(rows[0]||null):rows,error:null,count:this.wantCount?count:null}).then(resolve); }
}

function response() {
  let resolve; const finished=new Promise(done => { resolve=done; });
  return { statusCode:0,headers:{},setHeader(name,value){this.headers[name]=value;},end(body){this.body=body;resolve();},finished };
}

test('market listing, price history, and wallet summary API handlers return exact JSON integers', async () => {
  const services=require('../server/services.cjs');
  services.getDatabase=() => ({from:name => new Query(name)});
  services.contract=(address) => address.toLowerCase() === '0x8b49953059cdff91b1b2702b46d43a8a30fe58e8'
    ? {claimable:async()=>123456n,earnedByMarket:async()=>18000n}
    : {marketState:async()=>0n,resolvedOutcome:async()=>0n,volume:async()=>3000000n,lastYesPrice:async()=>60n,
      collateralVault:async()=> '0x4444444444444444444444444444444444444444',sharesOf:async()=>3n,locked:async()=>3000000n};
  delete require.cache[require.resolve('../server/queries.cjs')];
  for (const path of ['../api/markets/index.js','../api/markets/[address]/prices.js','../api/wallet/[address].js'])
    delete require.cache[require.resolve(path)];

  const marketHandler=require('../api/markets/index.js'), marketResponse=response();
  await marketHandler({method:'GET',query:{sort:'trending'}},marketResponse); await marketResponse.finished;
  const listed=JSON.parse(marketResponse.body); assert.equal(marketResponse.statusCode,200);
  assert.equal(listed.markets[0].volume,'3000000'); assert.equal(listed.markets[0].yesPrice,60);

  const pricesHandler=require('../api/markets/[address]/prices.js'), pricesResponse=response();
  await pricesHandler({method:'GET',query:{address:market}},pricesResponse); await pricesResponse.finished;
  const prices=JSON.parse(pricesResponse.body); assert.equal(prices.prices[0].notional,'3000000');

  const walletHandler=require('../api/wallet/[address].js'), walletResponse=response();
  await walletHandler({method:'GET',query:{address:wallet}},walletResponse); await walletResponse.finished;
  const summary=JSON.parse(walletResponse.body); assert.equal(summary.claimableCreatorFees,'123456');
  assert.equal(summary.earnedByMarket['0x1111111111111111111111111111111111111111'],'18000');
  assert.equal(summary.trades[0].shares,'3');
});
