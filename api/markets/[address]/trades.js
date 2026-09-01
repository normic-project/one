const { endpoint, address, page } = require('../../../server/http.cjs');
const { trades } = require('../../../server/queries.cjs');
module.exports = endpoint(request => { const paging=page(request); return trades(address(request),paging.offset,paging.end); }, { cache: true });
