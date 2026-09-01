export const CHAIN_ID = 4663;
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const FACTORY = import.meta.env.VITE_FACTORY_ADDRESS || '0xC34c45a032c72c211B9d7Ef9ce2E05a98Caa924a';
export const EVENT_IMPLEMENTATION = '0x60FEdb4c5d1ced9C102626A5bE71eA4F1AC7Aec1';
export const FEE_VAULT = import.meta.env.VITE_FEE_VAULT_ADDRESS || '0x8b49953059CDFf91b1B2702B46D43a8a30fE58e8';
export const ORDER_BOOK = import.meta.env.VITE_ORDER_BOOK_ADDRESS || '0x49E283E74eF0D454D90e50069a6b0FD80501fb39';
export const TREASURY = import.meta.env.VITE_TREASURY_ADDRESS || '0xDC2089B6fFF960007814F6e0D6D67E105a64624B';
export const RESOLVER_SAFE = import.meta.env.VITE_RESOLVER_SAFE_ADDRESS || '0x3203441F25934CA12E8b8Adf2be8F8e0AE389112';
export const DEPLOYMENT_BLOCK = Number(import.meta.env.VITE_DEPLOYMENT_BLOCK || 51943083);
export const NETWORK = { chainId: '0x1237', chainName: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] };
export const TOKEN_ABI = ['function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns(uint256)', 'function balanceOf(address) view returns(uint256)',
  'function decimals() view returns(uint8)', 'function symbol() view returns(string)'];
