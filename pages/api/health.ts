// @ts-nocheck
const { config } = require("../../src/admin-runtime");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  res.status(200).json({
    ok: true,
    uptime: Number(process.uptime().toFixed(3)),
    adminsProvider: config.adminsProvider,
    hasSupabaseUrl: Boolean(config.supabaseUrl),
    hasSupabaseKey: Boolean(config.supabaseRestKey),
    now: new Date().toISOString()
  });
}

