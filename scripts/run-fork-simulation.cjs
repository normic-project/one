require('dotenv').config();

const http = require('node:http');
const { spawn } = require('node:child_process');

const upstream = process.env.RH_RPC_URL;
if (!upstream) throw new Error('RH_RPC_URL is required.');
const forkBlock = process.env.FORK_BLOCK || '51198521';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function forward(call) {
  let lastError;
  for (let attempt = 0; attempt < 5; ++attempt) {
    try {
      const response = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', connection: 'close' },
        body: JSON.stringify(call),
        signal: AbortSignal.timeout(30_000)
      });
      if (response.ok) return response.json();
      if (response.status < 500 && response.status !== 429)
        throw new Error(`RPC ${call.method || 'unknown'} returned HTTP ${response.status}.`);
      lastError = new Error(`RPC ${call.method || 'unknown'} returned retryable HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await wait(500 * (attempt + 1));
  }
  throw lastError;
}

const server = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    let result;
    if (Array.isArray(payload)) {
      result = [];
      // The managed endpoint has strict concurrency limits. Preserve JSON-RPC batch order while
      // splitting the batch into serial upstream calls so Hardhat cannot create a retry storm.
      for (const call of payload) result.push(await forward(call));
    } else result = await forward(payload);
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error(`Fork RPC proxy: ${error.message}`);
    response.statusCode = 502;
    response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000,
      message: 'Upstream RPC transport failed; see redacted local error.' } }));
  }
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const cli = require.resolve('hardhat/internal/cli/cli');
  const child = spawn(process.execPath, [cli, 'run', 'scripts/simulate.cjs'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, SIMULATE_FORK: '1', FORK_BLOCK: forkBlock,
      HARDHAT_FORK_RPC_URL: `http://127.0.0.1:${port}` }
  });
  child.once('exit', code => server.close(() => { process.exitCode = code ?? 1; }));
  child.once('error', error => server.close(() => {
    console.error(error.message);
    process.exitCode = 1;
  }));
});
