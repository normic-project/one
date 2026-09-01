const { endpoint, address } = require('../../server/http.cjs');
const { walletSummary } = require('../../server/queries.cjs');
module.exports = endpoint(request => walletSummary(address(request)), { cache: true });
