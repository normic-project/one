const { isAddress, getAddress } = require('ethers');

function queryValue(request, name) {
  const raw = request.query?.[name];
  return Array.isArray(raw) ? raw[0] : raw;
}
function page(request) {
  const limit = Math.max(1, Math.min(100, Number(queryValue(request, 'limit') || 24) || 24));
  const cursor = Math.max(0, Number(queryValue(request, 'offset') || 0) || 0);
  return { limit, offset: cursor, end: cursor + limit - 1 };
}
function address(request) {
  const value = queryValue(request, 'address') || '';
  if (!isAddress(value)) throw Object.assign(new Error('Invalid EVM address.'), { statusCode: 400 });
  return getAddress(value).toLowerCase();
}
function send(response, status, body, cache = false) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', cache ? 'public, s-maxage=10, stale-while-revalidate=30' : 'no-store');
  response.end(JSON.stringify(body));
}
function endpoint(action, { cache = false } = {}) {
  return async (request, response) => {
    if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' });
    try { return send(response, 200, await action(request), cache); }
    catch (error) {
      console.error(error.message);
      return send(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Production data is temporarily unavailable.' });
    }
  };
}
function databaseError(error, label) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

module.exports = { queryValue, page, address, endpoint, databaseError };
