import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserProvider } from 'ethers';
import type { Eip1193Provider, JsonRpcSigner } from 'ethers';
import { CHAIN_ID, NETWORK } from './config';
import { errorMessage, short } from './chain';
import { enableWalletConnect, getWalletConnectProvider, walletConnectConfigured } from './walletConnect';
import type { RemoteWalletProvider } from './walletConnect';
import { Wallet as WalletIcon, X, ArrowUpRight } from 'lucide-react';
import { useDialog } from './useDialog';

type Injected = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
type WalletDetail = { info: { uuid: string; name: string; icon: string; rdns?: string }; provider: Injected };
type SelectedWallet = { provider: Injected; kind: 'injected' | 'walletconnect' };
type WalletState = { account: string; chainId: number; connect: () => void; disconnect: () => void;
  signer: () => Promise<JsonRpcSigner>; switchNetwork: () => Promise<void> };

const Context = createContext<WalletState | null>(null);
const WALLETCONNECT_SESSION = 'one-shot:walletconnect-session';
const INJECTED_CONNECT_TIMEOUT_MS = 60_000;

function withTimeout<T>(request: Promise<T>, milliseconds: number) {
  let timeout = 0;
  return Promise.race([
    request,
    new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => reject(new Error('Wallet connection timed out. Please try again.')), milliseconds);
    }),
  ]).finally(() => window.clearTimeout(timeout));
}

function connectionErrorMessage(cause: unknown) {
  const value = cause as { code?: string | number };
  if (value.code === 'ACTION_REJECTED' || String(value.code) === '4001') {
    return 'Connection request declined. Nothing was changed.';
  }
  return errorMessage(cause);
}

function safeWalletIcon(icon: string) {
  if (icon.startsWith('data:image/')) return icon;
  try {
    const url = new URL(icon);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<WalletDetail[]>([]);
  const [selected, setSelected] = useState<SelectedWallet | null>(null);
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState(0);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useDialog(open, () => { if (!pending) setOpen(false); });

  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<WalletDetail>).detail;
      setWallets(current => {
        if (current.some(wallet => wallet.info.uuid === detail.info.uuid)) return current;
        const withoutGenericDuplicate = current.filter(wallet => wallet.info.uuid !== 'injected' || wallet.provider !== detail.provider);
        return [...withoutGenericDuplicate, detail];
      });
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const injected = (window as Window & { ethereum?: Injected }).ethereum;
    if (injected) {
      setWallets(current => current.some(wallet => wallet.provider === injected) ? current : [
        ...current, { info: { uuid: 'injected', name: 'Browser wallet', icon: '' }, provider: injected },
      ]);
    }
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);

  useEffect(() => {
    if (!walletConnectConfigured || localStorage.getItem(WALLETCONNECT_SESSION) !== 'active') return;
    let active = true;
    void getWalletConnectProvider().then(async provider => {
      if (!active || !provider.session) return;
      const [accounts, connectedChain] = await Promise.all([
        provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
        provider.request({ method: 'eth_chainId' }),
      ]);
      if (!active || !accounts[0]) return;
      setSelected({ provider, kind: 'walletconnect' });
      setAccount(accounts[0]);
      setChainId(Number(connectedChain));
    }).catch(() => localStorage.removeItem(WALLETCONNECT_SESSION));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const accounts = (...args: unknown[]) => {
      const next = (args[0] as string[])[0] || '';
      setAccount(next);
      if (!next && selected.kind === 'walletconnect') localStorage.removeItem(WALLETCONNECT_SESSION);
    };
    const chain = (...args: unknown[]) => setChainId(Number(args[0]));
    const disconnected = () => {
      if (selected.kind === 'walletconnect') localStorage.removeItem(WALLETCONNECT_SESSION);
      setSelected(null); setAccount(''); setChainId(0);
    };
    selected.provider.on?.('accountsChanged', accounts);
    selected.provider.on?.('chainChanged', chain);
    selected.provider.on?.('disconnect', disconnected);
    return () => {
      selected.provider.removeListener?.('accountsChanged', accounts);
      selected.provider.removeListener?.('chainChanged', chain);
      selected.provider.removeListener?.('disconnect', disconnected);
    };
  }, [selected]);

  const activate = useCallback(async (provider: Injected, kind: SelectedWallet['kind']) => {
    const accounts = kind === 'walletconnect'
      ? await enableWalletConnect(provider as RemoteWalletProvider)
      : await withTimeout(provider.request({ method: 'eth_requestAccounts' }) as Promise<string[]>, INJECTED_CONNECT_TIMEOUT_MS);
    if (!accounts[0]) throw new Error('The wallet did not provide an account.');
    const connectedChain = await provider.request({ method: 'eth_chainId' });
    setSelected({ provider, kind });
    setAccount(accounts[0]);
    setChainId(Number(connectedChain));
    if (kind === 'walletconnect') localStorage.setItem(WALLETCONNECT_SESSION, 'active');
    setOpen(false);
  }, []);

  const connectInjected = useCallback(async (wallet: WalletDetail) => {
    if (pending) return;
    setPending(true); setError('');
    try { await activate(wallet.provider, 'injected'); }
    catch (cause) { setError(connectionErrorMessage(cause)); }
    finally { setPending(false); }
  }, [activate, pending]);

  const connectRemote = useCallback(async () => {
    if (pending) return;
    setPending(true); setError(''); setOpen(false);
    try {
      const provider = await getWalletConnectProvider();
      await activate(provider, 'walletconnect');
    } catch (cause) {
      setError(connectionErrorMessage(cause));
      setOpen(true);
    } finally { setPending(false); }
  }, [activate, pending]);

  const switchNetwork = useCallback(async () => {
    if (!selected) { setOpen(true); return; }
    try { await selected.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: NETWORK.chainId }] }); }
    catch (cause) {
      if ((cause as { code: number }).code !== 4902) throw cause;
      await selected.provider.request({ method: 'wallet_addEthereumChain', params: [NETWORK] });
      await selected.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: NETWORK.chainId }] });
    }
    setChainId(Number(await selected.provider.request({ method: 'eth_chainId' })));
  }, [selected]);

  const disconnect = useCallback(() => {
    const current = selected;
    setSelected(null); setAccount(''); setChainId(0); setError('');
    localStorage.removeItem(WALLETCONNECT_SESSION);
    if (current?.kind === 'walletconnect') {
      void (current.provider as RemoteWalletProvider).disconnect().catch(() => undefined);
    }
  }, [selected]);

  async function signer() {
    if (!selected || !account) { setOpen(true); throw new Error('Connect your wallet to continue.'); }
    const actualChain = Number(await selected.provider.request({ method: 'eth_chainId' }));
    if (actualChain !== CHAIN_ID) throw new Error('Switch your wallet to the supported network first.');
    return new BrowserProvider(selected.provider, 'any').getSigner(account);
  }

  const openWalletPicker = useCallback(() => {
    setError('');
    if (wallets.length === 0 && walletConnectConfigured) {
      void connectRemote();
      return;
    }
    setOpen(true);
  }, [connectRemote, wallets.length]);

  const hasWalletOption = wallets.length > 0 || walletConnectConfigured;
  return <Context.Provider value={{ account, chainId, connect: openWalletPicker, disconnect, signer, switchNetwork }}>
    {children}
    {open && <div className="modal-backdrop" onClick={() => !pending && setOpen(false)}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={event => event.stopPropagation()}>
      <button className="icon-button close" aria-label="Close wallet dialog" disabled={pending} onClick={() => setOpen(false)}><X size={20} /></button>
      <div className="modal-symbol"><WalletIcon size={27} /></div><h2 id="wallet-title">Your wallet. Your market.</h2>
      <p>Choose a wallet to continue.</p>
      {wallets.map(wallet => {
        const icon = safeWalletIcon(wallet.info.icon);
        return <button className="wallet-option" disabled={pending} key={wallet.info.uuid} onClick={() => void connectInjected(wallet)}>
          <span className="wallet-option-icon">{icon ? <img src={icon} alt="" /> : <WalletIcon size={20} />}</span>
          <span className="wallet-option-copy"><strong>{wallet.info.name}</strong><small>Installed</small></span>
          <ArrowUpRight size={18} />
        </button>;
      })}
      {walletConnectConfigured && <button className="wallet-more" disabled={pending} onClick={() => void connectRemote()}>More wallets<ArrowUpRight size={16} /></button>}
      {!hasWalletOption && <div className="notice">No compatible wallet was detected. Open this page inside a wallet app, or try again when mobile wallet connections are available.</div>}
      {error && <p role="alert" className="error">{error}</p>}
      <small>We never ask for your private key or seed phrase.</small>
    </section></div>}
  </Context.Provider>;
}

export function useWallet() {
  const wallet = useContext(Context);
  if (!wallet) throw new Error('Wallet provider missing');
  return wallet;
}

export function WalletButton() {
  const wallet = useWallet();
  const [error, setError] = useState('');
  return <div className="wallet-control"><button className="button primary" onClick={() => {
    setError('');
    if (wallet.account && wallet.chainId !== CHAIN_ID) void wallet.switchNetwork().catch(cause => setError(errorMessage(cause)));
    else wallet.connect();
  }}><WalletIcon size={16} /><span>{!wallet.account ? 'Connect wallet' : wallet.chainId !== CHAIN_ID ? 'Switch network' : short(wallet.account)}</span></button>
    {wallet.account && <button className="disconnect" title="Disconnect" aria-label="Disconnect wallet" onClick={wallet.disconnect}><X size={14} /></button>}
    {error && <span role="alert" className="wallet-error">{error}</span>}</div>;
}
