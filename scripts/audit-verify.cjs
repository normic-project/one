const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const expectedSourceHash = 'sha256:6e85cda2cfac7c8a5c5d9814985d567f674bba54967593b0c270c02e49e29810';
const expectedTag = 'v1.0.0-preaudit';
const production = {
  AutoMarketImplementation: 'artifacts/contracts/AutoMarket.sol/AutoMarket.json',
  EventMarketImplementation: 'artifacts/contracts/EventMarket.sol/EventMarket.json',
  UniswapTwapResolver: 'artifacts/contracts/resolution/UniswapTwapResolver.sol/UniswapTwapResolver.json',
  MarketFactory: 'artifacts/contracts/MarketFactory.sol/MarketFactory.json',
  FeeVault: 'artifacts/contracts/FeeVault.sol/FeeVault.json',
  OrderBook: 'artifacts/contracts/OrderBook.sol/OrderBook.json',
  CollateralVault: 'artifacts/contracts/CollateralVault.sol/CollateralVault.json'
};

function sha256(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function digestFiles(base, selected) {
  const hash = crypto.createHash('sha256');
  for (const file of selected.sort()) {
    const content = fs.readFileSync(path.join(base, file));
    hash.update(Buffer.from(`${file.length}:${file}:${content.length}:`, 'utf8'));
    hash.update(content);
  }
  return `sha256:${hash.digest('hex')}`;
}

function walk(base, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) result.push(...walk(base, file));
    else result.push(file);
  }
  return result;
}

function git(args, options = {}) {
  const result = execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options });
  return Buffer.isBuffer(result) ? result : result.trim();
}

function run(label, command, args, cwd, env) {
  console.log(`AUDIT VERIFY: ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

function safeEnvironment() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(PRIVATE|MNEMONIC|SEED|KEYSTORE|PASSWORD|SECRET|TOKEN|API[_-]?KEY|RPC)/i.test(key)) continue;
    env[key] = value;
  }
  env.CI = '1';
  env.ONE_SHOT_AUDIT_VERIFY = '1';
  return env;
}

function copyFile(sourceRoot, targetRoot, file) {
  const source = path.join(sourceRoot, file);
  if (!fs.existsSync(source) || fs.statSync(source).isDirectory()) return;
  const target = path.join(targetRoot, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function assertCompiler(build, name) {
  if (build.solcVersion !== '0.8.28' || build.solcLongVersion !== '0.8.28+commit.7893614a.Emscripten.clang')
    throw new Error(`${name}: compiler version mismatch`);
  const settings = build.input.settings;
  if (!settings.optimizer?.enabled || settings.optimizer.runs !== 200 || settings.evmVersion !== 'paris')
    throw new Error(`${name}: optimizer/EVM configuration mismatch`);
  const expectedViaIr = name === 'MarketFactory';
  if (Boolean(settings.viaIR) !== expectedViaIr) throw new Error(`${name}: viaIR mismatch`);
}

function verifyArtifact(temp, name, relative, expected) {
  const artifactPath = path.join(temp, relative);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const creation = Buffer.from(artifact.bytecode.slice(2), 'hex');
  const runtime = Buffer.from(artifact.deployedBytecode.slice(2), 'hex');
  if (sha256(creation) !== expected.creationBytecodeSha256) throw new Error(`${name}: creation bytecode mismatch`);
  if (sha256(runtime) !== expected.runtimeBytecodeSha256) throw new Error(`${name}: runtime bytecode mismatch`);
  const dbg = JSON.parse(fs.readFileSync(artifactPath.replace(/\.json$/, '.dbg.json'), 'utf8'));
  const buildPath = path.resolve(path.dirname(artifactPath), dbg.buildInfo);
  assertCompiler(JSON.parse(fs.readFileSync(buildPath, 'utf8')), name);
}

let temp;
try {
  const productionFiles = walk(root, 'contracts').filter(file => !file.startsWith('contracts/test/'));
  const sourceHash = digestFiles(root, productionFiles);
  if (sourceHash !== expectedSourceHash) throw new Error(`production source hash mismatch: ${sourceHash}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'audit/RELEASE_MANIFEST.json'), 'utf8'));
  if (manifest.hashes.frozenProductionContractSource !== expectedSourceHash || manifest.target.chainId !== 4663 ||
      manifest.git.tag !== expectedTag || manifest.securityReviewStatus !== 'NOT COMPLETED' ||
      manifest.legalReviewStatus !== 'NOT COMPLETED' || manifest.mainnetTransactionsBroadcast !== 0)
    throw new Error('release manifest consistency check failed');
  if (sha256(fs.readFileSync(path.join(root, 'package-lock.json'))) !== manifest.hashes.packageLock)
    throw new Error('package-lock identity mismatch');

  run('secret scan', process.execPath, [path.join(root, 'scripts/secret-scan.cjs')], root, safeEnvironment());

  const status = git(['status', '--porcelain']);
  if (status) throw new Error('Git worktree is not clean');
  const head = git(['rev-parse', 'HEAD']);
  const tagCommit = git(['rev-parse', `${expectedTag}^{commit}`]);
  if (head !== tagCommit || git(['cat-file', '-t', expectedTag]) !== 'tag')
    throw new Error('annotated pre-audit tag does not identify HEAD');

  temp = fs.mkdtempSync(path.join(root, '.audit-verify-tmp-'));
  const tempResolved = path.resolve(temp);
  if (path.dirname(tempResolved) !== root || !path.basename(tempResolved).startsWith('.audit-verify-tmp-'))
    throw new Error('unsafe temporary path');
  const files = git(['ls-files', '-z'], { encoding: 'buffer' }).toString('utf8').split('\0').filter(Boolean);
  for (const file of files) copyFile(root, temp, file);
  console.log('AUDIT VERIFY: materialize lockfile-pinned dependencies');
  fs.cpSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), { recursive: true, dereference: true });

  const env = safeEnvironment();
  const hardhat = path.join(temp, 'node_modules/hardhat/internal/cli/bootstrap.js');
  run('clean build state', process.execPath, [hardhat, 'clean'], temp, env);
  run('clean compile', process.execPath, [hardhat, 'compile'], temp, env);

  const expected = JSON.parse(fs.readFileSync(path.join(root, 'audit/artifacts/index.json'), 'utf8'));
  for (const [name, relative] of Object.entries(production)) verifyArtifact(temp, name, relative, expected[name]);

  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm_execpath is unavailable; run through npm run audit:verify');
  run('contract tests', process.execPath, [npmCli, 'test'], temp, env);
  run('lint', process.execPath, [npmCli, 'run', 'lint'], temp, env);
  run('production build', process.execPath, [npmCli, 'run', 'build', '--', '--configLoader', 'runner'], temp, env);
  run('browser tests', process.execPath, [npmCli, 'run', 'test:ui'], temp, env);
  run('production dependency audit', process.execPath, [npmCli, 'run', 'audit:production'], temp, env);

  const auditFiles = walk(root, 'audit');
  const excludedDirectories = new Set(['.git', 'node_modules', 'artifacts', 'cache', 'dist', 'reports', 'test-results', 'playwright-report', 'deployments']);
  function releaseFiles(directory = '.') {
    const result = [];
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory === '.' ? '' : directory.replaceAll('\\', '/'), entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) result.push(...releaseFiles(relative));
      } else if (entry.name !== '.env' && !entry.name.endsWith('.log')) result.push(relative);
    }
    return result;
  }
  console.log(JSON.stringify({
    status: 'PASS',
    sourceHash,
    gitCommit: head,
    gitTree: git(['rev-parse', 'HEAD^{tree}']),
    gitTag: expectedTag,
    auditPackageHash: digestFiles(root, auditFiles),
    auditPackagedReleaseHash: digestFiles(root, releaseFiles()),
    bytecodeReproducibility: 'PASS',
    secretsLoaded: false,
    broadcast: false
  }, null, 2));
} catch (error) {
  console.error(`AUDIT VERIFY BLOCKED: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (temp) {
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) === root && path.basename(resolved).startsWith('.audit-verify-tmp-'))
      fs.rmSync(resolved, { recursive: true, force: true });
  }
}
