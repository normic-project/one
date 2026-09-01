const { endpoint, page, queryValue } = require('../../server/http.cjs');
const { listMarkets } = require('../../server/queries.cjs');
module.exports = endpoint(request => {
  const paging = page(request);
  return listMarkets({ ...paging, category: queryValue(request,'category'), status: queryValue(request,'status'),
    sort: queryValue(request,'sort'), search: queryValue(request,'q') });
}, { cache: true });
