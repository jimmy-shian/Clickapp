import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // ★★★ 關鍵修正 1：設定相對路徑，讓 Android WebView 能讀取 ★★★
      base: '', 
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          // 通常建議指向 src，但你的設定指向根目錄也可以，只要你習慣
          '@': path.resolve(__dirname, './src'), 
        }
      },
      // ★★★ 關鍵修正 2：確保輸出的檔名比較乾淨 (可選，但推薦) ★★★
      build: {
        outDir: 'dist',
        assetsDir: 'assets',
        rollupOptions: {
          output: {
            entryFileNames: 'assets/[name].js',
            chunkFileNames: 'assets/[name].js',
            assetFileNames: 'assets/[name].[ext]'
          }
        }
      }
    };
});