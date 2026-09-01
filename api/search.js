const { endpoint, page, queryValue } = require('../server/http.cjs');
const { listMarkets } = require('../server/queries.cjs');
module.exports = endpoint(request => { const paging=page(request); return listMarkets({...paging,search:queryValue(request,'q'),sort:queryValue(request,'sort')||'trending'}); }, { cache: true });
