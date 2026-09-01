require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ContractFactory, Wallet, getCreateAddress, getAddress, formatEther, keccak256 } = require('ethers');
const { validate } = require('./validate.cjs');

function command(executable, args, env = process.env) {
  const result = spawnSync(executable, args, { stdio: 'inherit', env, shell: false });
  if (result.status !== 0) throw new Error(`Required gate failed: ${path.basename(executable)} ${args.join(' ')}`);
}

function npmScript(script, env = process.env) {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  command(process.execPath, [npmCli, 'run', script], env);
}

function artifact(name, relative = name) {
  return JSON.parse(fs.readFileSync(`artifacts/contracts/${relative}.sol/${name}.json`, 'utf8'));
}

function json(value) {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

async function deploy(compiled, args, signer, nonce, estimatedGas) {
  const contract = await new ContractFactory(compiled.abi, compiled.bytecode, signer)
    .deploy(...args, { nonce, gasLimit: estimatedGas * 120n / 100n });
  const receipt = await contract.deploymentTransaction().wait(2);
  return { contract, receipt };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--broadcast')) throw new Error('Only --broadcast is supported. There is no skip-checks flag.');
  const broadcast = args.includes('--broadcast');
  const preflightEnv = { ...process.env };
  // Quality-gate subprocesses never receive signing material, even if the operator supplied it early.
  delete preflightEnv.DEPLOYER_KEYSTORE;
  delete preflightEnv.DEPLOYER_KEYSTORE_PASSWORD;

  // Signing material is deliberately inaccessible until every independent gate below passes.
  for (const script of ['lint', 'build', 'test', 'test:ui', 'simulate', 'audit:production']) npmScript(script, preflightEnv);
  const { config, provider, result } = await validate();
  npmScript('simulate:fork', { ...preflightEnv, FORK_BLOCK: String(result.block) });

  const autoImplementationArtifact = artifact('AutoMarket');
  const eventImplementationArtifact = artifact('EventMarket');
  const resolverArtifact = artifact('UniswapTwapResolver', 'resolution/UniswapTwapResolver');
  const factoryArtifact = artifact('MarketFactory');
  const nonce = await provider.getTransactionCount(config.deployer, 'pending');
  const factoryAddress = getCreateAddress({ from: config.deployer, nonce: nonce + 3 });
  const orderBookAddress = getCreateAddress({ from: factoryAddress, nonce: 2 });
  const predicted = {
    autoResolver: getCreateAddress({ from: config.deployer, nonce }),
    autoMarketImplementation: getCreateAddress({ from: config.deployer, nonce: nonce + 1 }),
    eventMarketImplementation: getCreateAddress({ from: config.deployer, nonce: nonce + 2 }),
    factory: factoryAddress,
    orderBook: orderBookAddress,
    feeVault: getCreateAddress({ from: factoryAddress, nonce: 1 })
  };
  const reserved = [config.treasury, config.usdg, config.weth, config.pool, config.resolverMultisig]
    .map(value => value.toLowerCase());
  if (Object.values(predicted).some(value => reserved.includes(value.toLowerCase())))
    throw new Error('A predicted deployment address collides with a configured production address.');

  const constructorArgs = {
    autoResolver: [config.weth, config.usdg, config.pool, config.twapWindow],
    autoMarketImplementation: [config.usdg, predicted.orderBook, predicted.autoResolver],
    eventMarketImplementation: [config.usdg, predicted.orderBook, config.resolverMultisig,
      config.eventProposalBond, config.eventDisputePeriod],
    factory: [config.usdg, config.treasury, predicted.autoResolver, config.resolverMultisig,
      config.eventProposalBond, config.eventDisputePeriod,
      predicted.autoMarketImplementation, predicted.eventMarketImplementation]
  };
  const simulation = JSON.parse(fs.readFileSync('reports/mainnet-simulation.json', 'utf8'));
  const measuredGas = {
    autoMarketImplementation: BigInt(simulation.gas.autoMarketImplementation),
    eventMarketImplementation: BigInt(simulation.gas.eventMarketImplementation),
    autoResolver: BigInt(simulation.gas.autoResolver),
    factory: BigInt(simulation.gas.factory)
  };
  const totalGas = Object.values(measuredGas).reduce((sum, value) => sum + value, 0n);
  if (totalGas !== BigInt(simulation.gas.totalDeployment)) throw new Error('Fork gas report total is inconsistent.');

  const txData = {
    autoMarketImplementation: await new ContractFactory(autoImplementationArtifact.abi, autoImplementationArtifact.bytecode)
      .getDeployTransaction(...constructorArgs.autoMarketImplementation),
    eventMarketImplementation: await new ContractFactory(eventImplementationArtifact.abi, eventImplementationArtifact.bytecode)
      .getDeployTransaction(...constructorArgs.eventMarketImplementation),
    autoResolver: await new ContractFactory(resolverArtifact.abi, resolverArtifact.bytecode)
      .getDeployTransaction(...constructorArgs.autoResolver),
    factory: await new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode)
      .getDeployTransaction(...constructorArgs.factory)
  };
  for (const [name, tx] of Object.entries(txData)) {
    if (!tx.data || tx.data === '0x') throw new Error(`${name} constructor data is empty.`);
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
  if (!gasPrice) throw new Error('RPC did not provide gas pricing.');
  const estimatedETH = totalGas * gasPrice;
  const recommendedBalance = estimatedETH * 130n / 100n;
  const currentBalance = await provider.getBalance(config.deployer);
  const plan = {
    chainId: 4663,
    forkBlock: Number(simulation.forkBlock),
    validatedHeadBlock: result.block,
    deployer: config.deployer,
    treasury: config.treasury,
    resolverMultisig: config.resolverMultisig,
    usdg: config.usdg,
    weth: config.weth,
    pool: config.pool,
    twapWindow: config.twapWindow,
    eventProposalBond: config.eventProposalBond.toString(),
    eventDisputePeriod: config.eventDisputePeriod,
    nonce,
    predicted,
    constructorArgs,
    measuredForkGas: Object.fromEntries(Object.entries(measuredGas).map(([key, value]) => [key, value.toString()])),
    totalGas: totalGas.toString(),
    gasPriceWei: gasPrice.toString(),
    estimatedETH: formatEther(estimatedETH),
    recommendedBalanceETH: formatEther(recommendedBalance),
    currentDeployerBalanceETH: formatEther(currentBalance),
    additionalETHRequired: formatEther(currentBalance >= recommendedBalance ? 0n : recommendedBalance - currentBalance),
    bytecodeHashes: {
      autoMarketImplementation: keccak256(autoImplementationArtifact.bytecode),
      eventMarketImplementation: keccak256(eventImplementationArtifact.bytecode),
      autoResolver: keccak256(resolverArtifact.bytecode),
      factory: keccak256(factoryArtifact.bytecode)
    },
    constructorDataHashes: Object.fromEntries(Object.entries(txData).map(([key, tx]) => [key, keccak256(tx.data)])),
    l1DataFee: 'unavailable-from-standard-RPC',
    broadcast,
    timestamp: new Date().toISOString()
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/deployment-plan.json', json(plan) + '\n');
  console.log(json(plan));
  if (!broadcast) {
    console.log('DRY RUN COMPLETE. No signing credential was read and no transaction was broadcast.');
    return;
  }

  if (process.env.SECURITY_REVIEW_ACK !== 'independently-audited' ||
      process.env.LEGAL_REVIEW_ACK !== 'approved-for-target-jurisdictions')
    throw new Error('Broadcast is blocked until real independent security and legal reviews are acknowledged.');
  if (!process.env.DEPLOYER_KEYSTORE || !process.env.DEPLOYER_KEYSTORE_PASSWORD)
    throw new Error('Broadcast requires an encrypted JSON keystore and its password via environment variables.');
  const signer = (await Wallet.fromEncryptedJson(
    fs.readFileSync(process.env.DEPLOYER_KEYSTORE, 'utf8'), process.env.DEPLOYER_KEYSTORE_PASSWORD)).connect(provider);
  if (getAddress(signer.address) !== config.deployer) throw new Error('Keystore does not match DEPLOYER_ADDRESS.');
  if (await provider.getTransactionCount(config.deployer, 'pending') !== nonce)
    throw new Error('Deployer nonce changed after simulation. Rerun the full gate.');
  if (await provider.getBalance(config.deployer) < recommendedBalance)
    throw new Error('Deployer ETH balance is below measured fork cost plus 30% headroom.');
  if (BigInt(await provider.send('eth_chainId', [])) !== 4663n)
    throw new Error('RPC changed network before broadcast.');

  fs.mkdirSync('deployments', { recursive: true });
  const manifestPath = `deployments/mainnet-${predicted.factory}.json`;
  const manifest = { ...plan, status: 'broadcast-started', transactions: {} };
  const record = () => fs.writeFileSync(manifestPath, json(manifest) + '\n');
  record();
  const autoResolver = await deploy(resolverArtifact, constructorArgs.autoResolver,
    signer, nonce, measuredGas.autoResolver);
  Object.assign(manifest.transactions, { autoResolver: autoResolver.receipt.hash }); record();
  const autoMarketImplementation = await deploy(autoImplementationArtifact, constructorArgs.autoMarketImplementation,
    signer, nonce + 1, measuredGas.autoMarketImplementation);
  Object.assign(manifest.transactions, { autoMarketImplementation: autoMarketImplementation.receipt.hash }); record();
  const eventMarketImplementation = await deploy(eventImplementationArtifact, constructorArgs.eventMarketImplementation,
    signer, nonce + 2, measuredGas.eventMarketImplementation);
  Object.assign(manifest.transactions, { eventMarketImplementation: eventMarketImplementation.receipt.hash }); record();
  const factory = await deploy(factoryArtifact, constructorArgs.factory,
    signer, nonce + 3, measuredGas.factory);
  Object.assign(manifest.transactions, { factory: factory.receipt.hash });

  if (getAddress(factory.contract.target) !== getAddress(predicted.factory) ||
      getAddress(await factory.contract.token()) !== config.usdg ||
      getAddress(await factory.contract.treasury()) !== config.treasury ||
      getAddress(await factory.contract.autoResolver()) !== getAddress(autoResolver.contract.target) ||
      getAddress(await factory.contract.resolverMultisig()) !== config.resolverMultisig ||
      getAddress(await factory.contract.autoMarketImplementation()) !== getAddress(autoMarketImplementation.contract.target) ||
      getAddress(await factory.contract.eventMarketImplementation()) !== getAddress(eventMarketImplementation.contract.target) ||
      getAddress(await factory.contract.orderBook()) !== getAddress(predicted.orderBook) ||
      getAddress(await factory.contract.feeVault()) !== getAddress(predicted.feeVault))
    throw new Error('Post-deployment immutable constructor validation failed. Inspect the partial manifest immediately.');
  Object.assign(manifest, {
    status: 'deployed-awaiting-source-verification-and-frontend-activation',
    deploymentBlock: factory.receipt.blockNumber,
    orderBook: await factory.contract.orderBook(),
    feeVault: await factory.contract.feeVault()
  });
  record();
  console.log(`Deployment recorded: ${manifestPath}. Verify source and constructor arguments before frontend activation.`);
}

main().catch(error => {
  console.error(`Deployment stopped: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
