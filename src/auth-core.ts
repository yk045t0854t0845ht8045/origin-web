// @ts-nocheck
const crypto = require("crypto");

const ADMIN_AUTH_COOKIE_NAME = "origin_admin_auth";
const STEAM_AUTH_STATE_COOKIE_NAME = "origin_steam_auth_state";
const ADMIN_AUTH_COOKIE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const STEAM_AUTH_STATE_TTL_MS = 1000 * 60 * 10;
const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const SUPABASE_TIMEOUT_MS = 5000;
const STEAM_SUMMARY_FETCH_LIMIT = 100;
const STEAM_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BOOTSTRAP_ADMIN_IDS = ["76561199481226329"];

const STAFF_ROLE = Object.freeze({
  DEVELOPER: "developer",
  ADMINISTRADOR: "administrador",
  STAFF: "staff"
});

const ROLE_PERMISSIONS = Object.freeze({
  [STAFF_ROLE.DEVELOPER]: Object.freeze({
    manageStaff: true,
    publishGame: true,
    editGame: true,
    removeGame: true,
    manageMaintenance: true
  }),
  [STAFF_ROLE.ADMINISTRADOR]: Object.freeze({
    manageStaff: false,
    publishGame: true,
    editGame: false,
    removeGame: false,
    manageMaintenance: true
  }),
  [STAFF_ROLE.STAFF]: Object.freeze({
    manageStaff: false,
    publishGame: false,
    editGame: false,
    removeGame: false,
    manageMaintenance: false
  })
});

const steamProfileCache = new Map();

function readText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isValidSteamId(value) {
  return /^\d{17}$/.test(readText(value));
}

function parseCookieHeader(value) {
  const source = readText(value);
  if (!source) return {};
  const out = {};
  for (const pair of source.split(";")) {
    const [rawKey, ...parts] = String(pair || "").split("=");
    const key = readText(rawKey);
    if (!key) continue;
    const rawValue = parts.join("=").trim();
    if (!rawValue) {
      out[key] = "";
      continue;
    }
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch (_error) {
      out[key] = rawValue;
    }
  }
  return out;
}

function getSessionSecret() {
  return readText(process.env.SESSION_SECRET, "change-me-origin-web-admin");
}

function getSteamApiKey() {
  return readText(process.env.STEAM_API_KEY || process.env.STEAM_WEB_API_KEY || process.env.STEAM_KEY);
}

function isSteamLoginEnabled() {
  const normalized = readText(process.env.STEAM_LOGIN_ENABLED, "true").toLowerCase();
  return !["0", "false", "no", "off", "disabled"].includes(normalized);
}

function getSteamLoginState() {
  if (!isSteamLoginEnabled()) {
    return {
      ready: false,
      reason: "Login Steam desativado por STEAM_LOGIN_ENABLED=false no servidor."
    };
  }
  return { ready: true, reason: "" };
}

function signToken(encodedPayload, secret) {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function createPersistentAuthToken(user) {
  const steamId = readText(user?.steamId);
  if (!isValidSteamId(steamId)) return "";
  const issuedAt = Date.now();
  const payload = {
    sid: steamId,
    dn: readText(user?.displayName, steamId).slice(0, 128),
    av: readText(user?.avatar).slice(0, 1024),
    iat: issuedAt,
    exp: issuedAt + ADMIN_AUTH_COOKIE_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signToken(encodedPayload, getSessionSecret());
  return `${encodedPayload}.${signature}`;
}

function readPersistentAuthToken(rawToken) {
  const token = readText(rawToken);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return null;

  const expectedSignature = signToken(encodedPayload, getSessionSecret());
  const receivedBuffer = Buffer.from(encodedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null;

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }

  const steamId = readText(payload?.sid);
  if (!isValidSteamId(steamId)) return null;
  const expiresAt = Number(payload?.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return {
    steamId,
    displayName: readText(payload?.dn, steamId),
    avatar: readText(payload?.av)
  };
}

function createSteamStateToken() {
  const now = Date.now();
  const payload = {
    n: crypto.randomBytes(12).toString("base64url"),
    iat: now,
    exp: now + STEAM_AUTH_STATE_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signToken(encodedPayload, getSessionSecret());
  return `${encodedPayload}.${signature}`;
}

function readSteamStateToken(rawToken) {
  const token = readText(rawToken);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return null;

  const expectedSignature = signToken(encodedPayload, getSessionSecret());
  const receivedBuffer = Buffer.from(encodedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null;

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }
  const expiresAt = Number(payload?.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return payload;
}

function normalizeRole(roleRaw, fallback = STAFF_ROLE.STAFF) {
  const role = readText(roleRaw).toLowerCase();
  if (!role) return fallback;
  if (["developer", "dev", "super-admin", "super_admin", "superadmin", "owner", "root"].includes(role)) {
    return STAFF_ROLE.DEVELOPER;
  }
  if (["administrador", "admin", "administrator", "administrador(a)", "moderator", "mod", "manager", "gerente"].includes(role)) {
    return STAFF_ROLE.ADMINISTRADOR;
  }
  return STAFF_ROLE.STAFF;
}

function getRolePermissions(roleRaw) {
  const role = normalizeRole(roleRaw, STAFF_ROLE.STAFF);
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[STAFF_ROLE.STAFF];
}

function parseList(value) {
  return String(value || "")
    .split(/[,\n;\s]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSteamSummaryPlayer(player) {
  const steamId = readText(player?.steamid);
  if (!isValidSteamId(steamId)) {
    return null;
  }
  return {
    steamId,
    displayName: readText(player?.personaname, steamId),
    avatar: readText(player?.avatarfull || player?.avatarmedium || player?.avatar),
    profileUrl: `https://steamcommunity.com/profiles/${steamId}`
  };
}

function readSteamCommunityXmlTag(xml, tagName) {
  const source = String(xml || "");
  const tag = String(tagName || "").trim();
  if (!source || !tag) {
    return "";
  }
  const cdataPattern = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const cdataMatch = source.match(cdataPattern);
  if (cdataMatch?.[1]) {
    return String(cdataMatch[1]).trim();
  }
  const plainPattern = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "i");
  const plainMatch = source.match(plainPattern);
  if (plainMatch?.[1]) {
    return String(plainMatch[1]).trim();
  }
  return "";
}

async function fetchSteamCommunityProfileBySteamId(steamId) {
  const safeSteamId = readText(steamId);
  if (!isValidSteamId(safeSteamId)) {
    return null;
  }
  try {
    const response = await fetch(`https://steamcommunity.com/profiles/${safeSteamId}/?xml=1`, {
      method: "GET",
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!response.ok) {
      return null;
    }
    const xml = await response.text();
    if (!xml) {
      return null;
    }
    const displayName = readSteamCommunityXmlTag(xml, "steamID");
    const avatar =
      readSteamCommunityXmlTag(xml, "avatarFull") ||
      readSteamCommunityXmlTag(xml, "avatarMedium") ||
      readSteamCommunityXmlTag(xml, "avatarIcon");
    return {
      steamId: safeSteamId,
      displayName: readText(displayName, safeSteamId),
      avatar: readText(avatar),
      profileUrl: `https://steamcommunity.com/profiles/${safeSteamId}`
    };
  } catch (_error) {
    return null;
  }
}

async function fetchSteamProfilesBySteamIds(steamIds = []) {
  const ids = Array.from(new Set((Array.isArray(steamIds) ? steamIds : []).map((entry) => readText(entry)).filter(isValidSteamId)));
  if (!ids.length) {
    return new Map();
  }

  const now = Date.now();
  const result = new Map();
  const pending = [];
  for (const steamId of ids) {
    const cached = steamProfileCache.get(steamId);
    if (cached && Number(cached.expiresAt || 0) > now && cached.profile) {
      result.set(steamId, cached.profile);
      continue;
    }
    pending.push(steamId);
  }

  const steamApiKey = getSteamApiKey();
  if (pending.length && steamApiKey) {
    for (let index = 0; index < pending.length; index += STEAM_SUMMARY_FETCH_LIMIT) {
      const batch = pending.slice(index, index + STEAM_SUMMARY_FETCH_LIMIT);
      if (!batch.length) continue;

      try {
        const endpoint = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
        endpoint.searchParams.set("key", steamApiKey);
        endpoint.searchParams.set("steamids", batch.join(","));
        const response = await fetch(endpoint.toString(), {
          method: "GET",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) continue;
        const json = await response.json().catch(() => null);
        const players = Array.isArray(json?.response?.players) ? json.response.players : [];
        const batchProfiles = new Map();
        for (const player of players) {
          const mapped = normalizeSteamSummaryPlayer(player);
          if (!mapped) continue;
          batchProfiles.set(mapped.steamId, mapped);
        }
        for (const steamId of batch) {
          const profile = batchProfiles.get(steamId);
          if (!profile) continue;
          steamProfileCache.set(steamId, {
            profile,
            expiresAt: now + STEAM_SUMMARY_CACHE_TTL_MS
          });
          result.set(steamId, profile);
        }
      } catch (_error) {
        // Keep login flow functional even when Steam profile lookup fails.
      }
    }
  }

  const unresolvedIds = ids.filter((steamId) => !result.has(steamId));
  for (const steamId of unresolvedIds) {
    const fallbackProfile = await fetchSteamCommunityProfileBySteamId(steamId);
    if (!fallbackProfile) continue;
    steamProfileCache.set(steamId, {
      profile: fallbackProfile,
      expiresAt: now + STEAM_SUMMARY_CACHE_TTL_MS
    });
    result.set(steamId, fallbackProfile);
  }

  return result;
}

async function fetchSteamProfileBySteamId(steamId) {
  const profiles = await fetchSteamProfilesBySteamIds([steamId]);
  return profiles.get(readText(steamId)) || null;
}

function parseBootstrapAdminTable(value) {
  const rows = String(value || "")
    .split(/\r?\n|,/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const admins = [];
  for (const row of rows) {
    const [steamId, _staffName, staffRole] = row.split("|").map((entry) => entry.trim());
    if (!isValidSteamId(steamId)) continue;
    admins.push({ steamId, staffRole: normalizeRole(staffRole || STAFF_ROLE.STAFF) });
  }
  return admins;
}

function parseBootstrapAdminsJson(value) {
  const raw = readText(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        steamId: readText(entry?.steamId),
        staffRole: normalizeRole(entry?.staffRole || entry?.role || STAFF_ROLE.STAFF)
      }))
      .filter((entry) => isValidSteamId(entry.steamId));
  } catch (_error) {
    return [];
  }
}

function buildBootstrapRoleMap() {
  const map = new Map();
  const ids = [
    ...DEFAULT_BOOTSTRAP_ADMIN_IDS,
    ...parseList(process.env.SITE_BOOTSTRAP_ADMIN_IDS || "")
  ];
  for (const steamId of ids) {
    if (isValidSteamId(steamId)) map.set(steamId, STAFF_ROLE.DEVELOPER);
  }
  for (const entry of parseBootstrapAdminTable(process.env.SITE_BOOTSTRAP_ADMIN_TABLE || "")) {
    map.set(entry.steamId, entry.staffRole);
  }
  for (const entry of parseBootstrapAdminsJson(process.env.SITE_BOOTSTRAP_ADMINS_JSON || "")) {
    map.set(entry.steamId, entry.staffRole);
  }
  return map;
}

function resolveRequestBaseUrl(req) {
  const forwardedProto = readText(req.headers?.["x-forwarded-proto"]).split(",")[0].trim().toLowerCase();
  const forwardedHost = readText(req.headers?.["x-forwarded-host"]).split(",")[0].trim();
  const host = forwardedHost || readText(req.headers?.host);
  if (host) {
    const normalizedHost = host.toLowerCase();
    const isLocalHost =
      normalizedHost.includes("localhost") ||
      normalizedHost.startsWith("127.0.0.1") ||
      normalizedHost.startsWith("[::1]") ||
      normalizedHost.startsWith("::1");
    const protocol = forwardedProto || (isLocalHost ? "http" : "https");
    return `${protocol}://${host}`.replace(/\/+$/g, "");
  }
  const baseFromEnv = readText(process.env.BASE_URL);
  if (baseFromEnv) return baseFromEnv.replace(/\/+$/g, "");
  const vercelUrl = readText(process.env.VERCEL_URL);
  return vercelUrl ? `https://${vercelUrl}` : "";
}

function buildSteamOpenIdRedirectUrl(returnToUrl, realmUrl) {
  const endpoint = new URL(STEAM_OPENID_ENDPOINT);
  endpoint.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  endpoint.searchParams.set("openid.mode", "checkid_setup");
  endpoint.searchParams.set("openid.return_to", returnToUrl);
  endpoint.searchParams.set("openid.realm", realmUrl);
  endpoint.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  endpoint.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return endpoint.toString();
}

function toStringMap(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [key, entry] of Object.entries(source)) {
    if (entry === undefined || entry === null) continue;
    if (Array.isArray(entry)) {
      if (!entry.length) continue;
      out[key] = readText(entry[0]);
      continue;
    }
    out[key] = readText(entry);
  }
  return out;
}

function extractSteamIdFromClaimedId(claimedIdRaw) {
  const claimedId = readText(claimedIdRaw);
  if (!claimedId) return "";
  const matched = claimedId.match(/\/openid\/id\/(\d{17})\/?$/i) || claimedId.match(/\/id\/(\d{17})\/?$/i);
  return readText(matched?.[1]);
}

async function verifySteamOpenIdAssertion(queryMap) {
  const form = new URLSearchParams();
  form.set("openid.mode", "check_authentication");
  for (const [key, value] of Object.entries(queryMap || {})) {
    if (!key.startsWith("openid.")) continue;
    if (key === "openid.mode") continue;
    form.set(key, String(value || ""));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString(),
      signal: controller.signal
    });
    if (!response.ok) return false;
    const body = await response.text();
    return /is_valid\s*:\s*true/i.test(String(body || ""));
  } catch (_error) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldUseSecureCookies(req) {
  const forwardedProto = readText(req.headers?.["x-forwarded-proto"]).split(",")[0].trim().toLowerCase();
  if (forwardedProto) return forwardedProto === "https";
  const host = readText(req.headers?.host).toLowerCase();
  if (!host) return process.env.NODE_ENV === "production";
  return !host.includes("localhost") && !host.startsWith("127.0.0.1");
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value || ""))}`];
  parts.push(`Path=${readText(options.path, "/")}`);
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  parts.push(`SameSite=${readText(options.sameSite, "Lax")}`);
  if (options.secure) {
    parts.push("Secure");
  }
  if (Number.isFinite(options.maxAge)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(Number(options.maxAge)))}`);
    parts.push(`Expires=${new Date(Date.now() + Math.max(0, Number(options.maxAge)) * 1000).toUTCString()}`);
  }
  if (options.expires) {
    parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  }
  return parts.join("; ");
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }
  const list = Array.isArray(current) ? current : [String(current)];
  list.push(cookieValue);
  res.setHeader("Set-Cookie", list);
}

function setAuthCookie(res, req, user) {
  const token = createPersistentAuthToken(user);
  if (!token) return;
  appendSetCookie(
    res,
    serializeCookie(ADMIN_AUTH_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureCookies(req),
      maxAge: Math.floor(ADMIN_AUTH_COOKIE_TTL_MS / 1000)
    })
  );
}

function clearAuthCookie(res, req) {
  appendSetCookie(
    res,
    serializeCookie(ADMIN_AUTH_COOKIE_NAME, "", {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureCookies(req),
      maxAge: 0,
      expires: 0
    })
  );
}

function setSteamStateCookie(res, req, token) {
  appendSetCookie(
    res,
    serializeCookie(STEAM_AUTH_STATE_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureCookies(req),
      maxAge: Math.floor(STEAM_AUTH_STATE_TTL_MS / 1000)
    })
  );
}

function clearSteamStateCookie(res, req) {
  appendSetCookie(
    res,
    serializeCookie(STEAM_AUTH_STATE_COOKIE_NAME, "", {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureCookies(req),
      maxAge: 0,
      expires: 0
    })
  );
}

async function fetchAdminFromSupabase(steamId) {
  const supabaseUrl = readText(
    process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  ).replace(/\/+$/g, "");
  const supabaseKey = readText(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SERVICE_ROLE ||
      process.env.SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.ANON
  );
  const schema = readText(process.env.SITE_ADMINS_SUPABASE_SCHEMA, "public");
  const table = readText(process.env.SITE_ADMINS_SUPABASE_TABLE, "admin_steam_ids");

  if (!supabaseUrl || !supabaseKey) {
    return { mode: "local", admin: null, error: "" };
  }

  const endpoint = new URL(`${supabaseUrl}/rest/v1/${table}`);
  endpoint.searchParams.set("select", "steam_id,staff_role");
  endpoint.searchParams.set("steam_id", `eq.${steamId}`);
  endpoint.searchParams.set("limit", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: "application/json",
        "Accept-Profile": schema
      },
      signal: controller.signal
    });

    const bodyText = await response.text();
    const json = (() => {
      try {
        return JSON.parse(bodyText);
      } catch (_error) {
        return null;
      }
    })();
    if (!response.ok) {
      const message = readText(json?.message || json?.error || json?.details, `Falha Supabase (${response.status}).`);
      return {
        mode: "supabase",
        admin: null,
        error: `[ADMINS_SUPABASE_ME_HTTP_${response.status}] ${message}`
      };
    }
    const row = Array.isArray(json) ? json[0] : null;
    return {
      mode: "supabase",
      admin: row
        ? {
            steamId: readText(row.steam_id),
            staffRole: normalizeRole(row.staff_role, STAFF_ROLE.STAFF)
          }
        : null,
      error: ""
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        mode: "supabase",
        admin: null,
        error: `[ADMINS_SUPABASE_ME_TIMEOUT] Supabase nao respondeu em ${SUPABASE_TIMEOUT_MS / 1000}s.`
      };
    }
    return {
      mode: "supabase",
      admin: null,
      error: `[ADMINS_SUPABASE_ME_ERROR] ${readText(error?.message, "Falha ao consultar Supabase.")}`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveAdminsProvider() {
  const providerRaw = readText(process.env.SITE_ADMINS_PROVIDER, "auto").toLowerCase();
  const provider = ["auto", "supabase", "local", "sqlite"].includes(providerRaw) ? providerRaw : "auto";
  const remoteConfigured = Boolean(readText(process.env.SUPABASE_URL) && readText(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
  const useSupabase = provider === "supabase" || (provider === "auto" && remoteConfigured);
  return {
    provider,
    useSupabase
  };
}

async function buildViewerFromRequest(req) {
  const steamState = getSteamLoginState();
  const cookies = parseCookieHeader(req.headers?.cookie || "");
  const token = readText(cookies[ADMIN_AUTH_COOKIE_NAME]);
  const tokenUser = readPersistentAuthToken(token);

  if (!tokenUser) {
    return {
      authenticated: false,
      isAdmin: false,
      adminError: "",
      role: "",
      permissions: getRolePermissions(STAFF_ROLE.STAFF),
      user: null,
      steamLoginReady: steamState.ready,
      steamLoginReason: steamState.reason,
      adminStorage: resolveAdminsProvider().useSupabase ? "supabase" : "local"
    };
  }

  let user = {
    steamId: readText(tokenUser.steamId),
    displayName: readText(tokenUser.displayName, readText(tokenUser.steamId)),
    avatar: readText(tokenUser.avatar)
  };
  const shouldRefreshProfile = !user.avatar || !user.displayName || user.displayName === user.steamId;
  if (shouldRefreshProfile) {
    const steamProfile = await fetchSteamProfileBySteamId(user.steamId);
    if (steamProfile) {
      user = {
        steamId: readText(steamProfile.steamId, user.steamId),
        displayName: readText(steamProfile.displayName, user.steamId),
        avatar: readText(steamProfile.avatar)
      };
    }
  }

  const bootstrapRoleMap = buildBootstrapRoleMap();
  const bootstrapRole = bootstrapRoleMap.get(user.steamId) || "";
  const providerInfo = resolveAdminsProvider();

  let resolvedRole = bootstrapRole || "";
  let adminError = "";
  let isAdmin = Boolean(bootstrapRole);
  let adminStorage = providerInfo.useSupabase ? "supabase" : "local";

  if (providerInfo.useSupabase && !bootstrapRole) {
    const remote = await fetchAdminFromSupabase(user.steamId);
    adminStorage = remote.mode;
    if (remote.error) {
      adminError = remote.error;
    } else if (remote.admin) {
      isAdmin = true;
      resolvedRole = remote.admin.staffRole;
    } else {
      isAdmin = false;
      resolvedRole = "";
    }
  }

  const role = isAdmin ? normalizeRole(resolvedRole, STAFF_ROLE.STAFF) : "";
  const permissions = isAdmin ? getRolePermissions(role) : getRolePermissions(STAFF_ROLE.STAFF);

  return {
    authenticated: true,
    isAdmin,
    adminError,
    role,
    permissions,
    user,
    steamLoginReady: steamState.ready,
    steamLoginReason: steamState.reason,
    adminStorage
  };
}

module.exports = {
  ADMIN_AUTH_COOKIE_NAME,
  STEAM_AUTH_STATE_COOKIE_NAME,
  getSteamLoginState,
  parseCookieHeader,
  resolveRequestBaseUrl,
  buildSteamOpenIdRedirectUrl,
  toStringMap,
  fetchSteamProfileBySteamId,
  createSteamStateToken,
  readSteamStateToken,
  verifySteamOpenIdAssertion,
  extractSteamIdFromClaimedId,
  setSteamStateCookie,
  clearSteamStateCookie,
  setAuthCookie,
  clearAuthCookie,
  buildViewerFromRequest
};
