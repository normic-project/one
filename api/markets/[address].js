const { endpoint, address } = require('../../server/http.cjs');
const { getMarket } = require('../../server/queries.cjs');
module.exports = endpoint(request => getMarket(address(request)), { cache: true });
