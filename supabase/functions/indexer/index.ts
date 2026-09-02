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
    const body = await request.json().catch(() => ({}));
    const rpc = Deno.env.get('RH_RPC_URL');
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!rpc || !url || !key) throw new Error('Required server configuration is missing.');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.probe === true) {
      const rpcResponse = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(10000) });
      const rpcResult = await rpcResponse.json() as { error?: unknown; result?: string };
      if (!rpcResponse.ok || rpcResult.error || Number.parseInt(rpcResult.result, 16) !== 4663)
        throw new Error('Robinhood RPC probe failed.');
      const { data, error } = await client.from('indexer_state').select('last_indexed_block')
        .eq('chain_id', 4663).maybeSingle().abortSignal(AbortSignal.timeout(10000));
      if (error || !data) throw new Error('Supabase database probe failed.');
      return Response.json({ status: 'ok', chainId: 4663, database: true },
        { headers: { 'cache-control': 'no-store' } });
    }
    const provider = new JsonRpcProvider(rpc, 4663, { batchMaxCount: 1, staticNetwork: true });
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
