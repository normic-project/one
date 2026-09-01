const { getAddress } = require('ethers');

const config = Object.freeze({
  chainId: 4663,
  deploymentBlock: 51943083,
  factory: getAddress('0xC34c45a032c72c211B9d7Ef9ce2E05a98Caa924a'),
  eventImplementation: getAddress('0x60FEdb4c5d1ced9C102626A5bE71eA4F1AC7Aec1'),
  feeVault: getAddress('0x8b49953059CDFf91b1B2702B46D43a8a30fE58e8'),
  orderBook: getAddress('0x49E283E74eF0D454D90e50069a6b0FD80501fb39'),
  usdg: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
  resolverSafe: getAddress('0x3203441F25934CA12E8b8Adf2be8F8e0AE389112'),
  treasury: getAddress('0xDC2089B6fFF960007814F6e0D6D67E105a64624B')
});

module.exports = config;
