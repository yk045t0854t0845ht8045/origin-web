// @ts-nocheck
const { clearAuthCookie, clearSteamStateCookie } = require("../../src/auth-core");

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  clearAuthCookie(res, req);
  clearSteamStateCookie(res, req);
  res.status(200).json({ ok: true });
}
