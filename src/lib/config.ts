export const CHAIN_ID = 4663;
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const RPC = import.meta.env.VITE_RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
export const FACTORY = import.meta.env.VITE_FACTORY_ADDRESS || '';
export const DEPLOYMENT_BLOCK = Number(import.meta.env.VITE_DEPLOYMENT_BLOCK || 0);
export const NETWORK = { chainId: '0x1237', chainName: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] };
export const TOKEN_ABI = ['function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns(uint256)', 'function balanceOf(address) view returns(uint256)',
  'function decimals() view returns(uint8)', 'function symbol() view returns(string)'];
