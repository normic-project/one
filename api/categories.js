const { endpoint } = require('../server/http.cjs');
const { categories } = require('../server/queries.cjs');
module.exports = endpoint(() => categories(), { cache: true });
