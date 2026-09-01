const { createClient } = require('@supabase/supabase-js');
const { JsonRpcProvider, Contract } = require('ethers');
const config = require('./config.cjs');

let database;
let provider;

function getDatabase() {
  if (database) return database;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Server database configuration is unavailable.');
  database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'one-shot-api/1.0' } } });
  return database;
}

function getProvider() {
  if (provider) return provider;
  if (!process.env.RH_RPC_URL) throw new Error('Server blockchain RPC is unavailable.');
  provider = new JsonRpcProvider(process.env.RH_RPC_URL, config.chainId, { batchMaxCount: 1, staticNetwork: true });
  return provider;
}

function contract(address, abi) { return new Contract(address, abi, getProvider()); }

module.exports = { getDatabase, getProvider, contract };
