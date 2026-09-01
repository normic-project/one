require('dotenv').config();
const { JsonRpcProvider } = require('ethers');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const command = process.argv[2] || 'once';
  if (!['once', 'backfill', 'reindex'].includes(command)) throw new Error('Usage: node scripts/indexer.cjs [once|backfill|reindex]');
  if (!process.env.RH_RPC_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('RH_RPC_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required server-side.');
  const [{ runIndexer }, { SupabaseStore }, constants] = await Promise.all([
    import('../supabase/functions/_shared/indexer-core.mjs'),
    import('../supabase/functions/_shared/supabase-store.mjs'),
    import('../supabase/functions/_shared/constants.mjs')
  ]);
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const store = new SupabaseStore(client);
  if (command === 'reindex') await store.rpc('rollback_one_shot_from_block', {
    p_chain_id: constants.CHAIN_ID, p_from_block: constants.DEPLOYMENT_BLOCK });
  const provider = new JsonRpcProvider(process.env.RH_RPC_URL, constants.CHAIN_ID,
    { batchMaxCount: 1, staticNetwork: true });
  let finished = false;
  while (!finished) {
    const result = await runIndexer({ provider, store,
      confirmations: Number(process.env.INDEXER_CONFIRMATIONS || 32),
      batchSize: Number(process.env.INDEXER_BATCH_SIZE || 1000),
      reorgDepth: Number(process.env.INDEXER_REORG_DEPTH || 64) });
    console.log(JSON.stringify(result));
    finished = command === 'once' || result.status === 'caught_up';
  }
}
main().catch(error => { console.error(`Indexer failed: ${error.message}`); process.exitCode = 1; });
