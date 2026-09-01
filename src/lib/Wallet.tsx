import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserProvider } from 'ethers';
import type { Eip1193Provider, JsonRpcSigner } from 'ethers';
import { CHAIN_ID, NETWORK } from './config';
import { errorMessage, short } from './chain';
import { Wallet as WalletIcon, X, ArrowUpRight } from 'lucide-react';
import { useDialog } from './useDialog';

type Injected = Eip1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void; };
type WalletDetail = { info: { uuid: string; name: string; icon: string }; provider: Injected };
type WalletState = { account: string; chainId: number; connect: () => void; disconnect: () => void;
  signer: () => Promise<JsonRpcSigner>; switchNetwork: () => Promise<void> };
const Context = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<WalletDetail[]>([]);
  const [selected, setSelected] = useState<Injected | null>(null);
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState(0);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useDialog(open, () => { if (!pending) setOpen(false); });
  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<WalletDetail>).detail;
      setWallets(current => current.some(w => w.info.uuid === detail.info.uuid) ? current : [...current, detail]);
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const injected = (window as Window & { ethereum?: Injected }).ethereum;
    if (injected) setWallets(current => current.length ? current : [{ info: { uuid: 'injected', name: 'Browser wallet', icon: '' }, provider: injected }]);
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const accounts = (...args: unknown[]) => setAccount((args[0] as string[])[0] || '');
    const chain = (...args: unknown[]) => setChainId(Number(args[0]));
    const disconnect = () => { setAccount(''); setChainId(0); };
    selected.on?.('accountsChanged', accounts);
    selected.on?.('chainChanged', chain);
    selected.on?.('disconnect', disconnect);
    return () => { selected.removeListener?.('accountsChanged', accounts); selected.removeListener?.('chainChanged', chain); selected.removeListener?.('disconnect', disconnect); };
  }, [selected]);
  const switchNetwork = useCallback(async () => {
    if (!selected) { setOpen(true); return; }
    try { await selected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: NETWORK.chainId }] }); }
    catch (e) {
      if ((e as { code: number }).code !== 4902) throw e;
      await selected.request({ method: 'wallet_addEthereumChain', params: [NETWORK] });
      await selected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: NETWORK.chainId }] });
    }
    setChainId(Number(await selected.request({ method: 'eth_chainId' })));
  }, [selected]);
  async function connect(wallet: WalletDetail) {
    setPending(true); setError('');
    try {
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await wallet.provider.request({ method: 'eth_chainId' });
      setSelected(wallet.provider); setAccount(accounts[0] || ''); setChainId(Number(chain)); setOpen(false);
    } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
  }
  async function signer() {
    if (!selected || !account) { setOpen(true); throw new Error('Connect your wallet to continue.'); }
    const actualChain = Number(await selected.request({ method: 'eth_chainId' }));
    if (actualChain !== CHAIN_ID) throw new Error('Switch your wallet to Robinhood Chain mainnet first.');
    return new BrowserProvider(selected, 'any').getSigner(account);
  }
  return <Context.Provider value={{ account, chainId, connect: () => { setOpen(true); setError(''); },
    disconnect: () => { setSelected(null); setAccount(''); }, signer, switchNetwork }}>
    {children}
    {open && <div className="modal-backdrop" onClick={() => !pending && setOpen(false)}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={e => e.stopPropagation()}>
      <button className="icon-button close" aria-label="Close wallet dialog" onClick={() => setOpen(false)}><X size={20} /></button>
      <div className="modal-symbol"><WalletIcon size={27} /></div><h2 id="wallet-title">Your wallet. Your market.</h2>
      <p>Connect an EVM wallet to trade with USDG on Robinhood Chain.</p>
      {wallets.length ? wallets.map(wallet => <button className="wallet-option" disabled={pending} key={wallet.info.uuid} onClick={() => void connect(wallet)}><WalletIcon size={20} />{wallet.info.name}<ArrowUpRight size={18} /></button>) :
        <div className="notice">No wallet detected. Install an EVM browser wallet such as MetaMask or Robinhood Wallet, then refresh this page.</div>}
      {error && <p role="alert" className="error">{error}</p>}
      <small>We never ask for your private key or seed phrase.</small>
    </section></div>}
  </Context.Provider>;
}
export function useWallet() { const wallet = useContext(Context); if (!wallet) throw new Error('Wallet provider missing'); return wallet; }
export function WalletButton() {
  const wallet = useWallet();
  const [error, setError] = useState('');
  return <div className="wallet-control"><button className="button primary" onClick={() => {
    if (wallet.account && wallet.chainId !== CHAIN_ID) void wallet.switchNetwork().catch(e => setError(errorMessage(e)));
    else wallet.connect();
  }}><WalletIcon size={16} /><span>{!wallet.account ? 'Connect wallet' : wallet.chainId !== CHAIN_ID ? 'Switch network' : short(wallet.account)}</span></button>
    {wallet.account && <button className="disconnect" title="Disconnect" aria-label="Disconnect wallet" onClick={wallet.disconnect}><X size={14} /></button>}
    {error && <span role="alert" className="wallet-error">{error}</span>}</div>;
}
