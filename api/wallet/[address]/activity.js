const { endpoint, address, page } = require('../../../server/http.cjs');
const { walletActivity } = require('../../../server/queries.cjs');
module.exports = endpoint(request => { const paging=page(request); return walletActivity(address(request),paging.offset,paging.end); }, { cache: true });
