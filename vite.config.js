import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const ALLOWED = [
  "qt.gtimg.cn",
  "web.ifzq.gtimg.cn",
  "fundsuggest.eastmoney.com",
  "api.fund.eastmoney.com",
];

function devProxyPlugin() {
  return {
    name: "dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/proxy", async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const target = url.searchParams.get("url");
        if (!target) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "missing url param" }));
          return;
        }
        let parsed;
        try {
          parsed = new URL(target);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid url" }));
          return;
        }
        if (!ALLOWED.includes(parsed.hostname)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "domain not allowed" }));
          return;
        }
        try {
          const upstream = await fetch(target, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          const buf = Buffer.from(await upstream.arrayBuffer());
          const ct = upstream.headers.get("content-type") || "application/octet-stream";
          res.writeHead(upstream.status, {
            "Content-Type": ct,
            "Access-Control-Allow-Origin": "*",
          });
          res.end(buf);
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), devProxyPlugin()],
  server: {
    proxy: {
      "/openai": {
        target: "https://api.longcat.chat",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
