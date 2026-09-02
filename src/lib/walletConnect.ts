import type { Eip1193Provider } from 'ethers';
import { CHAIN_ID, RPC } from './config';

export type RemoteWalletProvider = Eip1193Provider & {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown;
  enable: () => Promise<string[]>;
  disconnect: () => Promise<void>;
  session?: unknown;
  modal?: { close: () => void };
};

const projectId = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '').trim();
const BITGET_WALLET_ID = '38f5d18bd8522c244bdd70cb4a68e0e718865155811c043f052fb9f1c51de662';
const CONNECT_TIMEOUT_MS = 90_000;
let providerPromise: Promise<RemoteWalletProvider> | null = null;

export const walletConnectConfigured = /^[a-fA-F0-9]{32}$/.test(projectId);

function testProvider() {
  if (import.meta.env.MODE !== 'e2e') return undefined;
  return (window as Window & { __ONE_SHOT_WALLETCONNECT_PROVIDER__?: RemoteWalletProvider })
    .__ONE_SHOT_WALLETCONNECT_PROVIDER__;
}

export async function getWalletConnectProvider() {
  const injectedTestProvider = testProvider();
  if (injectedTestProvider) return injectedTestProvider;
  if (!walletConnectConfigured) {
    throw new Error('Mobile wallet connections are not configured for this site.');
  }
  if (!providerPromise) {
    providerPromise = import('@walletconnect/ethereum-provider').then(async ({ EthereumProvider }) => {
      const origin = window.location.origin;
      return EthereumProvider.init({
        projectId,
        chains: [CHAIN_ID],
        rpcMap: { [CHAIN_ID]: RPC },
        showQrModal: true,
        metadata: {
          name: 'One Shot',
          description: 'Fully collateralized event markets.',
          url: origin,
          icons: [new URL('/apple-touch-icon.png', origin).href],
        },
        optionalMethods: [
          'eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'eth_call', 'eth_getBalance',
          'eth_estimateGas', 'eth_gasPrice', 'eth_getCode', 'eth_getTransactionByHash',
          'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_feeHistory', 'eth_maxPriorityFeePerGas',
          'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain',
        ],
        optionalEvents: ['disconnect', 'connect', 'message'],
        qrModalOptions: {
          enableExplorer: true,
          enableMobileFullScreen: true,
          explorerRecommendedWalletIds: [BITGET_WALLET_ID],
          themeMode: 'light',
          themeVariables: {
            '--wcm-accent-color': '#6E1F2A',
            '--wcm-accent-fill-color': '#FCFAF6',
            '--wcm-background-color': '#FCFAF6',
            '--wcm-background-border-radius': '7px',
            '--wcm-container-border-radius': '7px',
            '--wcm-button-border-radius': '6px',
            '--wcm-font-family': "'DM Sans', sans-serif",
            '--wcm-z-index': '100',
          },
        },
      }).then(provider => provider as unknown as RemoteWalletProvider);
    }).catch(error => {
      providerPromise = null;
      throw error;
    });
  }
  return providerPromise;
}

export async function enableWalletConnect(provider: RemoteWalletProvider) {
  let timeout = 0;
  try {
    return await Promise.race([
      provider.enable(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          provider.modal?.close();
          reject(new Error('Wallet connection timed out. Please try again.'));
        }, CONNECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export { CONNECT_TIMEOUT_MS };
