const { expect } = require('chai');
const { settings, address } = require('../scripts/validate.cjs');
describe('Mainnet deployment guards', () => {
  it('pins the documented mainnet chain and canonical token without secrets', () => {
    const config = settings({}, true);
    expect(config.usdg).to.equal('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
    expect(config.rpc).to.equal('https://rpc.mainnet.chain.robinhood.com');
  });
  it('rejects testnets, local RPCs, bad chain IDs, noncanonical tokens and incomplete configuration', () => {
    for (const env of [{ RH_CHAIN_ID: '46630' }, { RH_RPC_URL: 'https://rpc.testnet.chain.robinhood.com' },
      { RH_RPC_URL: 'http://127.0.0.1:8545' }, { USDG_ADDRESS: '0x0000000000000000000000000000000000001111' }])
      expect(() => settings(env, true)).to.throw();
    expect(() => settings({})).to.throw('TREASURY_ADDRESS');
    expect(() => address('0x0000000000000000000000000000000000000000', 'Treasury')).to.throw();
  });
});
