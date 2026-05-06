import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/openai": {
        target: "https://api.longcat.chat",
        changeOrigin: true,
        secure: false
      },
      "/gtimg": {
        target: "https://qt.gtimg.cn",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/gtimg/, "")
      },
      "/ifzq": {
        target: "https://web.ifzq.gtimg.cn",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/ifzq/, "")
      },
      "/fundsuggest": {
        target: "https://fundsuggest.eastmoney.com",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/fundsuggest/, "")
      },
      "/fundapi": {
        target: "https://api.fund.eastmoney.com",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/fundapi/, "")
      }
    }
  }
});
