import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WalletProvider } from './lib/Wallet';
import { ProtocolProvider } from './lib/Protocol';
import App from './App';
import './styles.css';
import './refinements.css';

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><WalletProvider><ProtocolProvider><App /></ProtocolProvider></WalletProvider></BrowserRouter></StrictMode>);
