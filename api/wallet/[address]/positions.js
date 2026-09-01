const { endpoint, address, page } = require('../../../server/http.cjs');
const { walletPositions } = require('../../../server/queries.cjs');
module.exports = endpoint(request => { const paging=page(request); return walletPositions(address(request),paging.offset,paging.end); }, { cache: true });
