import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: GitHub Pages serves the site at /<repo-name>/. Set VITE_BASE in the deploy workflow.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
});
