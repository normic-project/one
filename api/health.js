const { endpoint } = require('../server/http.cjs');
const { getDatabase, getProvider } = require('../server/services.cjs');
const config = require('../server/config.cjs');
module.exports = endpoint(async () => {
  const [{data,error},network,block] = await Promise.all([
    getDatabase().from('indexer_state').select('last_indexed_block,updated_at').eq('chain_id',config.chainId).single(),
    getProvider().getNetwork(), getProvider().getBlock('latest')
  ]);
  if(error) throw error;
  return {status:'ok',chainId:Number(network.chainId),headBlock:block.number,lastIndexedBlock:Number(data.last_indexed_block),updatedAt:data.updated_at};
});
