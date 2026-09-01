const { endpoint, address, page } = require('../../../server/http.cjs');
const { prices } = require('../../../server/queries.cjs');
module.exports = endpoint(request => { const paging=page(request); return prices(address(request),paging.offset,paging.end); }, { cache: true });
