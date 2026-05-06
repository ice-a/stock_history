import https from "node:https";

const ALLOWED = [
  "qt.gtimg.cn",
  "web.ifzq.gtimg.cn",
  "fundsuggest.eastmoney.com",
  "api.fund.eastmoney.com",
];

function fetchUrl(target) {
  return new Promise((resolve, reject) => {
    const req = https.get(target, { headers: { "User-Agent": "Mozilla/5.0" } }, (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks) }));
      resp.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const rawUrl = req.query.url;
    if (!rawUrl) {
      res.status(400).json({ error: "missing url" });
      return;
    }

    const parsed = new URL(rawUrl);
    if (!ALLOWED.includes(parsed.hostname)) {
      res.status(403).json({ error: "forbidden", host: parsed.hostname });
      return;
    }

    const result = await fetchUrl(rawUrl);
    res.setHeader("Content-Type", "application/octet-stream");
    res.status(result.status).send(result.body);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
