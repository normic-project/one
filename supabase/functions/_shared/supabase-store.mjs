const CHUNK = 200;

function fail(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export class SupabaseStore {
  constructor(client) { this.client = client; }

  async state(chainId) {
    const { data, error } = await this.client.from('indexer_state').select('*').eq('chain_id', chainId).maybeSingle();
    fail(error, 'read indexer state');
    return data;
  }

  async markets(chainId) {
    const { data, error } = await this.client.from('markets').select('address').eq('chain_id', chainId);
    fail(error, 'read market registry');
    return (data || []).map(row => row.address);
  }

  async orders(chainId, ids) {
    if (!ids.length) return [];
    const result = [];
    for (let offset = 0; offset < ids.length; offset += CHUNK) {
      const { data, error } = await this.client.from('orders').select('*').eq('chain_id', chainId)
        .in('order_id', ids.slice(offset, offset + CHUNK));
      fail(error, 'read orders');
      result.push(...(data || []));
    }
    return result;
  }

  async upsert(table, rows, onConflict) {
    for (let offset = 0; offset < rows.length; offset += CHUNK) {
      const { error } = await this.client.from(table).upsert(rows.slice(offset, offset + CHUNK), { onConflict });
      fail(error, `upsert ${table}`);
    }
  }

  async rpc(name, args) {
    const { data, error } = await this.client.rpc(name, args);
    fail(error, `rpc ${name}`);
    return data;
  }
}
