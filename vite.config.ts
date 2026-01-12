import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // This loads the environment variables from Cloudflare into Vite
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // This ensures the variables are globally available during build
      'process.env': env
    }
  };
});
