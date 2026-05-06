import https from "node:https";

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
          try {
            resolve({ status: resp.statusCode, data: JSON.parse(text) });
          } catch {
            resolve({ status: resp.statusCode, data: text });
          }
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const apiKey = process.env.LLM_API_KEY || "";
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const modelId = process.env.LLM_MODEL_ID || "gpt-4o-mini";

  if (!apiKey) {
    res.status(500).json({ error: "LLM_API_KEY not configured on server" });
    return;
  }

  const { messages } = req.body || {};
  if (!messages) {
    res.status(400).json({ error: "missing messages" });
    return;
  }

  try {
    const result = await postJson(`${baseUrl}/chat/completions`, {
      model: modelId,
      temperature: 0.7,
      messages,
    }, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
