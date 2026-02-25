// @ts-nocheck
const {
  getSteamLoginState,
  STEAM_AUTH_STATE_COOKIE_NAME,
  parseCookieHeader,
  toStringMap,
  readSteamStateToken,
  clearSteamStateCookie,
  verifySteamOpenIdAssertion,
  extractSteamIdFromClaimedId,
  setAuthCookie,
  clearAuthCookie
} = require("../../../../src/auth-core");

function readText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isValidSteamId(value) {
  return /^\d{17}$/.test(readText(value));
}

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

  try {
    const query = toStringMap(req.query);
    const stateFromQuery = readText(query.state);
    const cookies = parseCookieHeader(req.headers?.cookie || "");
    const stateFromCookie = readText(cookies[STEAM_AUTH_STATE_COOKIE_NAME]);
    const shouldValidateState = Boolean(stateFromQuery || stateFromCookie);
    const statePayload = shouldValidateState ? readSteamStateToken(stateFromQuery) : { n: "legacy" };

    clearSteamStateCookie(res, req);
    if (shouldValidateState && (!statePayload || !stateFromCookie || stateFromCookie !== stateFromQuery)) {
      clearAuthCookie(res, req);
      res.redirect(302, "/?error=steam-callback");
      return;
    }

    const assertionValid = await verifySteamOpenIdAssertion(query);
    if (!assertionValid) {
      clearAuthCookie(res, req);
      res.redirect(302, "/?error=steam-callback");
      return;
    }

    const claimedId = readText(query["openid.claimed_id"] || query["openid.identity"]);
    const steamId = extractSteamIdFromClaimedId(claimedId);
    if (!isValidSteamId(steamId)) {
      clearAuthCookie(res, req);
      res.redirect(302, "/?error=steam-callback");
      return;
    }

    setAuthCookie(res, req, {
      steamId,
      displayName: steamId,
      avatar: ""
    });
    res.redirect(302, "/?login=ok");
  } catch (_error) {
    clearSteamStateCookie(res, req);
    clearAuthCookie(res, req);
    res.redirect(302, "/?error=steam-callback");
  }
}
