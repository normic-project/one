import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { loadMarkets, loadProtocol, errorMessage } from './chain';
import type { Market, Protocol } from './chain';
import { FACTORY } from './config';

type State = { protocol: Protocol | null; markets: Market[]; total: number; loading: boolean;
  error: string; configured: boolean; refresh: () => Promise<void>; loadMore: () => Promise<void> };
const Context = createContext<State | null>(null);
export function ProtocolProvider({ children }: { children: ReactNode }) {
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(FACTORY));
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!FACTORY) return;
    setLoading(true); setError('');
    try {
      const instance = await loadProtocol();
      const data = await loadMarkets(instance);
      setProtocol(instance); setMarkets(data.markets); setTotal(data.total);
    } catch (e) { setError(errorMessage(e)); setProtocol(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function loadMore() {
    if (!protocol) return;
    setLoading(true);
    try { const data = await loadMarkets(protocol, markets.length); setMarkets(previous => [...previous, ...data.markets]); setTotal(data.total); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  return <Context.Provider value={{ protocol, markets, total, loading, error, configured: !!FACTORY, refresh, loadMore }}>{children}</Context.Provider>;
}
export function useProtocol() { const state = useContext(Context); if (!state) throw new Error('Protocol provider missing'); return state; }
