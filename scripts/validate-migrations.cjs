const fs = require('node:fs');
const path = require('node:path');

const directory = path.join(__dirname, '..', 'supabase', 'migrations');
const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
if (!files.length) throw new Error('No database migrations found.');
const sql = files.map(file => fs.readFileSync(path.join(directory,file),'utf8')).join('\n').toLowerCase();
const required = ['markets','trades','orders','order_events','wallet_activity','wallet_positions',
  'redemptions_claims','indexer_state','market_price_history','market_stats'];
for (const name of required) if (!sql.includes(name)) throw new Error(`Missing database object: ${name}`);
for (const token of ['real','double precision']) {
  const expression = new RegExp(`\\b${token.replace(' ','\\s+')}\\b`);
  if (expression.test(sql)) throw new Error(`Unsafe floating-point database type found: ${token}`);
}
if (!sql.includes('unique (chain_id, tx_hash, log_index)') && !sql.includes('primary key (chain_id, tx_hash, log_index)'))
  throw new Error('Canonical event identity constraint is missing.');
if (!sql.includes('51943083')) throw new Error('Deployment start block is missing.');
if (!sql.includes('rollback_one_shot_from_block')) throw new Error('Reorg rollback procedure is missing.');
console.log(`Validated ${files.length} migration files and ${required.length} required data objects.`);
