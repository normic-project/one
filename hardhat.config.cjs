require('dotenv').config();
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Pinned local solc: reproducible builds without downloading compiler binaries.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _, runSuper) => {
  if (solcVersion !== '0.8.28') return runSuper();
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true,
    version: solcVersion, longVersion: require('solc').version() };
});

const standardSettings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' };
const factoryIrSettings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'paris' };

module.exports = {
  solidity: {
    compilers: [{ version: '0.8.28', settings: standardSettings }],
    overrides: {
      // IR materially reduces constructor bytecode while preserving the deployed market/resolver bytecode.
      'contracts/MarketFactory.sol': { version: '0.8.28', settings: factoryIrSettings }
    }
  },
  networks: {
    // In-memory EVM, never a public testnet. Production scripts only accept 4663.
    hardhat: { chainId: 4663, ...(process.env.SIMULATE_FORK === '1' ? {
      // A localhost transport proxy may be used to normalize provider-specific HTTP behavior.
      // Validation inside the simulation still talks directly to RH_RPC_URL.
      forking: { url: process.env.HARDHAT_FORK_RPC_URL || process.env.RH_RPC_URL,
        blockNumber: Number(process.env.FORK_BLOCK) }
    } : {}) }
  },
  mocha: { timeout: 120000 }
};
