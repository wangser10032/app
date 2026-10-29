import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8080', '/mock': 'http://127.0.0.1:8080' }, watch: { usePolling: true } }, build: { outDir: 'dist', rollupOptions: { output: { manualChunks: { framework: ['react','react-dom','react-router-dom'], icons: ['@phosphor-icons/react'] } } } } });
