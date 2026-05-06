import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import https from "node:https";

const ALLOWED = [
  "qt.gtimg.cn",
  "web.ifzq.gtimg.cn",
  "fundsuggest.eastmoney.com",
  "api.fund.eastmoney.com",
];

function postJson(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) },
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          try { resolve({ status: resp.statusCode, data: JSON.parse(text) }); }
          catch { resolve({ status: resp.statusCode, data: text }); }
        });
        resp.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

function devProxyPlugin(env) {
  return {
    name: "dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/proxy", async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const target = url.searchParams.get("url");
        if (!target) { res.writeHead(400); res.end('{"error":"missing url"}'); return; }
        let parsed;
        try { parsed = new URL(target); } catch { res.writeHead(400); res.end('{"error":"invalid url"}'); return; }
        if (!ALLOWED.includes(parsed.hostname)) { res.writeHead(403); res.end('{"error":"forbidden"}'); return; }
        try {
          const upstream = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" } });
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream", "Access-Control-Allow-Origin": "*" });
          res.end(buf);
        } catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); }
      });

      server.middlewares.use("/api/chat", async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

        const apiKey = env.LLM_API_KEY || "";
        const baseUrl = (env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
        const modelId = env.LLM_MODEL_ID || "gpt-4o-mini";

        if (!apiKey) { res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"error":"LLM_API_KEY not set in .env"}'); return; }

        let body = "";
        req.on("data", (c) => body += c);
        req.on("end", async () => {
          try {
            const { messages } = JSON.parse(body);
            const result = await postJson(`${baseUrl}/chat/completions`, { model: modelId, temperature: 0.7, messages }, { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` });
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result.data));
          } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [vue(), devProxyPlugin(env)],
  };
});
