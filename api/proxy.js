const ALLOWED = [
  "qt.gtimg.cn",
  "web.ifzq.gtimg.cn",
  "fundsuggest.eastmoney.com",
  "api.fund.eastmoney.com",
];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const target = req.query.url;
    if (!target) return res.status(400).json({ error: "missing url param" });

    let url;
    try {
      url = new URL(target);
    } catch {
      return res.status(400).json({ error: "invalid url" });
    }
    if (!ALLOWED.includes(url.hostname)) {
      return res.status(403).json({ error: "domain not allowed", host: url.hostname });
    }

    const https = require("https");
    const buf = await new Promise((resolve, reject) => {
      https.get(target, { headers: { "User-Agent": "Mozilla/5.0" } }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => resolve(Buffer.concat(chunks)));
        resp.on("error", reject);
      }).on("error", reject);
    });

    res.setHeader("Content-Type", "application/octet-stream");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
};
