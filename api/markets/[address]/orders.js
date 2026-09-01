const { endpoint, address, page, queryValue } = require('../../../server/http.cjs');
const { orders } = require('../../../server/queries.cjs');
module.exports = endpoint(request => { const paging=page(request); return orders({market:address(request),open:queryValue(request,'open')==='true'},paging.offset,paging.end,true); }, { cache: true });
