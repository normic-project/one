const fs = require('node:fs');
const path = require('node:path');
const contracts = {
  MarketFactory: 'MarketFactory.sol', PredictionMarket: 'PredictionMarket.sol',
  OrderBook: 'OrderBook.sol', FeeVault: 'FeeVault.sol', CollateralVault: 'CollateralVault.sol',
  UniswapTwapResolver: 'resolution/UniswapTwapResolver.sol',
  AutoMarket: 'AutoMarket.sol', EventMarket: 'EventMarket.sol'
};
fs.mkdirSync('src/generated', { recursive: true });
for (const [name, file] of Object.entries(contracts)) {
  const artifact = JSON.parse(fs.readFileSync(path.join('artifacts/contracts', file, `${name}.json`), 'utf8'));
  fs.writeFileSync(`src/generated/${name}.json`, JSON.stringify(artifact.abi, null, 2) + '\n');
}
console.log('Exported production ABIs.');
