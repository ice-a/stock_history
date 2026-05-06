import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(() => {
  const llmBaseUrl = (process.env.VITE_LLM_BASE_URL || "").trim().replace(/\/+$/, "");

  // 构建代理配置对象
  const proxy = {};

  // LLM 代理（仅在配置了 BASE_URL 时启用）
  if (llmBaseUrl) {
    const targetOrigin = (() => {
      try {
        const url = new URL(llmBaseUrl);
        return `${url.protocol}//${url.host}`;
      } catch {
        return "";
      }
    })();

    if (targetOrigin) {
      proxy["/llm"] = {
        target: targetOrigin,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          try {
            const basePath = new URL(llmBaseUrl).pathname;
            const withoutPrefix = path.replace(/^\/llm/, "");
            return basePath + withoutPrefix;
          } catch {
            return path;
          }
        }
      };
    }
  }

  // 新浪行情接口代理（绕过 CORS）
  proxy["/sinajs"] = {
    target: "https://hq.sinajs.cn",
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/sinajs/, ""),
    headers: {
      Referer: "https://finance.sina.com.cn"
    }
  };

  // 东财基金数据接口代理（绕过 CORS）
  proxy["/funddata"] = {
    target: "https://fund.eastmoney.com",
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/funddata/, ""),
    headers: {
      Referer: "https://fund.eastmoney.com/"
    }
  };

  // 东财股票 K 线接口代理（绕过 CORS）
  proxy["/eastmoney"] = {
    target: "https://push2his.eastmoney.com",
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/eastmoney/, ""),
    headers: {
      Referer: "https://quote.eastmoney.com/"
    }
  };

  // 东财基金净值接口代理（绕过 CORS）
  proxy["/fundapi"] = {
    target: "https://api.fund.eastmoney.com",
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/fundapi/, ""),
    headers: {
      Referer: "https://fundf10.eastmoney.com/"
    }
  };

  return {
    plugins: [vue()],
    server: {
      proxy
    }
  };
});