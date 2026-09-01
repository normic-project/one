import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { JsonRpcProvider } from 'npm:ethers@6.17.0';
import { runIndexer } from '../_shared/indexer-core.mjs';
import { SupabaseStore } from '../_shared/supabase-store.mjs';

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expected = Deno.env.get('INDEXER_CRON_SECRET');
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`)
    return new Response('Unauthorized', { status: 401 });
  try {
    const rpc = Deno.env.get('RH_RPC_URL');
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!rpc || !url || !key) throw new Error('Required server configuration is missing.');
    const provider = new JsonRpcProvider(rpc, 4663, { batchMaxCount: 1, staticNetwork: true });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await runIndexer({ provider, store: new SupabaseStore(client),
      confirmations: Number(Deno.env.get('INDEXER_CONFIRMATIONS') || 32),
      batchSize: Number(Deno.env.get('INDEXER_BATCH_SIZE') || 1000),
      reorgDepth: Number(Deno.env.get('INDEXER_REORG_DEPTH') || 64) });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return Response.json({ status: 'error', message: 'Indexer execution failed.' }, { status: 500 });
  }
});
