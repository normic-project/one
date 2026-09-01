import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true },
  build: { sourcemap: false, target: 'es2022', rollupOptions: { output: { manualChunks: {
    ethereum: ['ethers'], react: ['react', 'react-dom', 'react-router-dom']
  } } } } });
