// @ts-nocheck
const {
  getSteamLoginState,
  resolveRequestBaseUrl,
  buildSteamOpenIdRedirectUrl,
  createSteamStateToken,
  setSteamStateCookie
} = require("../../../src/auth-core");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  const steamState = getSteamLoginState();
  if (!steamState.ready) {
    res.redirect(302, "/?error=steam-disabled");
    return;
  }

  const baseUrl = resolveRequestBaseUrl(req);
  if (!baseUrl) {
    res.redirect(302, "/?error=steam-login");
    return;
  }

  const stateToken = createSteamStateToken();
  setSteamStateCookie(res, req, stateToken);

  const returnToUrl = `${baseUrl}/api/auth/steam/return?state=${encodeURIComponent(stateToken)}`;
  const redirectUrl = buildSteamOpenIdRedirectUrl(returnToUrl, baseUrl);
  res.redirect(302, redirectUrl);
}
