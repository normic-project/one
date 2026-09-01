import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { loadProtocol, errorMessage } from './chain';
import type { Market, Protocol } from './chain';
import { apiCategories, apiMarkets } from './api';
import { FACTORY } from './config';

type State = { protocol: Protocol | null; markets: Market[]; categories: string[]; total: number; loading: boolean;
  error: string; configured: boolean; refresh: () => Promise<void>; loadMore: () => Promise<void>;
  queryMarkets: (options: Record<string,string>) => Promise<void> };
const Context = createContext<State | null>(null);
export function ProtocolProvider({ children }: { children: ReactNode }) {
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(FACTORY));
  const [error, setError] = useState('');
  const [options, setOptions] = useState<Record<string,string>>({ sort: 'trending' });
  const refresh = useCallback(async () => {
    if (!FACTORY) return;
    setLoading(true); setError('');
    try {
      const instance = await loadProtocol();
      const [data, availableCategories] = await Promise.all([apiMarkets(0, 24, options), apiCategories()]);
      setProtocol(instance); setMarkets(data.markets); setTotal(data.total);
      setCategories(availableCategories);
    } catch (e) { setError(errorMessage(e)); setProtocol(null); }
    finally { setLoading(false); }
  }, [options]);
  useEffect(() => { void refresh(); }, [refresh]);
  const queryMarkets = useCallback(async (next: Record<string,string>) => {
    setLoading(true); setError('');
    try { const data = await apiMarkets(0, 24, next); setMarkets(data.markets); setTotal(data.total); setOptions(next); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, []);
  async function loadMore() {
    if (!protocol) return;
    setLoading(true);
    try { const data = await apiMarkets(markets.length, 24, options); setMarkets(previous => [...previous, ...data.markets]); setTotal(data.total); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  return <Context.Provider value={{ protocol, markets, categories, total, loading, error, configured: !!FACTORY, refresh, loadMore, queryMarkets }}>{children}</Context.Provider>;
}
export function useProtocol() { const state = useContext(Context); if (!state) throw new Error('Protocol provider missing'); return state; }
