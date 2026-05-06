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

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: "missing url param" });

  let url;
  try {
    url = new URL(target);
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }
  if (!ALLOWED.includes(url.hostname)) {
    return res.status(403).json({ error: "domain not allowed" });
  }

  const upstream = await fetch(target, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const buf = Buffer.from(await upstream.arrayBuffer());
  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  res.setHeader("Content-Type", ct);
  res.status(upstream.status).send(buf);
};
