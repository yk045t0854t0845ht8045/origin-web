const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const config = require("./config");
const { initDatabase } = require("./db");
const { createAdminStore } = require("./admin-store");
const { createDriveService } = require("./drive");
const { isValidSteamId, slugify } = require("./utils");

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadTempDir, { recursive: true });

const MAX_GALLERY_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];
const ADMIN_AUTH_COOKIE_NAME = "origin_admin_auth";
const STEAM_AUTH_STATE_COOKIE_NAME = "origin_steam_auth_state";
const ADMIN_AUTH_COOKIE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const STEAM_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const STEAM_SUMMARY_FETCH_LIMIT = 100;
const STEAM_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";

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

const db = initDatabase(config);
db.bootstrapAdmins(config.bootstrapAdmins);
const adminStore = createAdminStore(config, db);
const driveService = createDriveService(config);
const steamProfileCache = new Map();
let backendReadyPromise = null;

function ensureBackendReady() {
  if (!backendReadyPromise) {
    backendReadyPromise = adminStore.initialize().catch((error) => {
      backendReadyPromise = null;
      throw error;
    });
  }
  return backendReadyPromise;
}

const isDev = process.env.NODE_ENV !== "production";
const useSecureCookies = !isDev;

function getAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    path: "/",
    maxAge: ADMIN_AUTH_COOKIE_TTL_MS
  };
}

function getClearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    path: "/"
  };
}

function parseCookieHeader(value) {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }
  const pairs = source.split(";");
  const result = {};
  for (const pair of pairs) {
    const [rawKey, ...rawValueParts] = String(pair || "").split("=");
    const key = String(rawKey || "").trim();
    if (!key) continue;
    const rawValue = rawValueParts.join("=").trim();
    if (!rawValue) {
      result[key] = "";
      continue;
    }
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch (_error) {
      result[key] = rawValue;
    }
  }
  return result;
}

function signAdminAuthPayload(encodedPayload) {
  return crypto.createHmac("sha256", config.sessionSecret).update(encodedPayload).digest("base64url");
}

function createPersistentAuthToken(user) {
  const steamId = String(user?.steamId || "").trim();
  if (!isValidSteamId(steamId)) {
    return "";
  }
  const issuedAt = Date.now();
  const payload = {
    sid: steamId,
    dn: String(user?.displayName || steamId)
      .trim()
      .slice(0, 128),
    av: String(user?.avatar || "")
      .trim()
      .slice(0, 1024),
    iat: issuedAt,
    exp: issuedAt + ADMIN_AUTH_COOKIE_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signAdminAuthPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function readPersistentAuthToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const expectedSignature = signAdminAuthPayload(encodedPayload);
  const receivedSignatureBuffer = Buffer.from(encodedSignature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
  if (receivedSignatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(receivedSignatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }

  const steamId = String(payload?.sid || "").trim();
  if (!isValidSteamId(steamId)) {
    return null;
  }
  const expiresAt = Number(payload?.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  return {
    steamId,
    displayName: String(payload?.dn || steamId).trim() || steamId,
    avatar: String(payload?.av || "").trim()
  };
}

function setPersistentAuthCookie(res, user) {
  const token = createPersistentAuthToken(user);
  if (!token) {
    return;
  }
  res.cookie(ADMIN_AUTH_COOKIE_NAME, token, getAuthCookieOptions());
}

function clearPersistentAuthCookie(res) {
  res.clearCookie(ADMIN_AUTH_COOKIE_NAME, getClearCookieOptions());
}

function signSteamAuthState(encodedPayload) {
  return crypto.createHmac("sha256", config.sessionSecret).update(encodedPayload).digest("base64url");
}

function createSteamAuthStateToken() {
  const now = Date.now();
  const payload = {
    n: crypto.randomBytes(12).toString("base64url"),
    iat: now,
    exp: now + STEAM_AUTH_STATE_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signSteamAuthState(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function readSteamAuthStateToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const expectedSignature = signSteamAuthState(encodedPayload);
  const receivedSignatureBuffer = Buffer.from(encodedSignature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
  if (receivedSignatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(receivedSignatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }
  const expiresAt = Number(payload?.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }
  return payload;
}

function setSteamAuthStateCookie(res, token) {
  res.cookie(STEAM_AUTH_STATE_COOKIE_NAME, token, {
    ...getAuthCookieOptions(),
    maxAge: STEAM_AUTH_STATE_TTL_MS
  });
}

function clearSteamAuthStateCookie(res) {
  res.clearCookie(STEAM_AUTH_STATE_COOKIE_NAME, getClearCookieOptions());
}

function getRequestHeader(req, headerName) {
  const value = req?.headers?.[headerName];
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

function resolveRequestBaseUrl(req) {
  const forwardedProto = readText(getRequestHeader(req, "x-forwarded-proto")).split(",")[0].trim().toLowerCase();
  const forwardedHost = readText(getRequestHeader(req, "x-forwarded-host")).split(",")[0].trim();
  const host = forwardedHost || getRequestHeader(req, "host");
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
  return String(config.baseUrl || "").trim().replace(/\/+$/g, "");
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
  const input = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [key, entryValue] of Object.entries(input)) {
    if (entryValue === undefined || entryValue === null) {
      continue;
    }
    if (Array.isArray(entryValue)) {
      if (!entryValue.length) continue;
      out[key] = String(entryValue[0] ?? "").trim();
      continue;
    }
    out[key] = String(entryValue).trim();
  }
  return out;
}

function extractSteamIdFromClaimedId(value) {
  const claimedId = String(value || "").trim();
  if (!claimedId) {
    return "";
  }
  const matched = claimedId.match(/\/openid\/id\/(\d{17})\/?$/i) || claimedId.match(/\/id\/(\d{17})\/?$/i);
  return String(matched?.[1] || "").trim();
}

async function verifySteamOpenIdAssertion(queryMap) {
  const form = new URLSearchParams();
  form.set("openid.mode", "check_authentication");
  for (const [key, value] of Object.entries(queryMap || {})) {
    if (!key.startsWith("openid.")) {
      continue;
    }
    if (key === "openid.mode") {
      continue;
    }
    form.set(key, String(value || ""));
  }

  const response = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  if (!response.ok) {
    return false;
  }
  const body = await response.text();
  return /is_valid\s*:\s*true/i.test(String(body || ""));
}

function normalizeStaffRole(value, fallback = STAFF_ROLE.STAFF) {
  const customNormalizer =
    adminStore && typeof adminStore.normalizeStaffRole === "function" ? adminStore.normalizeStaffRole : null;
  if (customNormalizer) {
    return customNormalizer(value, fallback);
  }

  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["developer", "dev", "super-admin", "super_admin", "superadmin", "owner", "root"].includes(normalized)) {
    return STAFF_ROLE.DEVELOPER;
  }
  if (
    [
      "administrador",
      "admin",
      "administrator",
      "administrador(a)",
      "moderator",
      "mod",
      "manager",
      "gerente"
    ].includes(normalized)
  ) {
    return STAFF_ROLE.ADMINISTRADOR;
  }
  return STAFF_ROLE.STAFF;
}

function getRolePermissions(roleRaw) {
  const role = normalizeStaffRole(roleRaw, STAFF_ROLE.STAFF);
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[STAFF_ROLE.STAFF];
}

function hasPermission(viewer, permissionName) {
  if (!viewer?.authenticated || !viewer?.isAdmin) {
    return false;
  }
  const permissions = viewer?.permissions || {};
  return Boolean(permissions[permissionName]);
}

function readText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseBooleanInput(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return Boolean(fallback);
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return Boolean(fallback);
}

function parseIntegerInput(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Number(fallback) || 0;
  }
  return Math.trunc(parsed);
}

function parsePositiveIntegerInput(value, fallback = 0) {
  const parsed = parseIntegerInput(value, fallback);
  return parsed > 0 ? parsed : Math.max(0, Number(fallback) || 0);
}

function parseArrayInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
  } catch (_error) {
    // Fallback to tokenized text input.
  }
  return raw
    .split(/[,\n;\r]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeImageExtension(file) {
  const originalExt = path.extname(String(file?.originalname || "")).toLowerCase();
  if (ALLOWED_IMAGE_EXTENSIONS.includes(originalExt)) {
    return originalExt === ".jpeg" ? ".jpg" : originalExt;
  }

  const mime = String(file?.mimetype || "").toLowerCase();
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/avif") return ".avif";
  return "";
}

function buildGalleryFileName(originalName, extension) {
  const baseName = path.basename(String(originalName || "imagem"), path.extname(String(originalName || "")));
  const safeName = slugify(baseName) || "imagem";
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${uniqueId}-${safeName}${extension}`;
}

function normalizeArchiveType(value) {
  return String(value || "rar")
    .trim()
    .toLowerCase() === "zip"
    ? "zip"
    : "rar";
}

function extractSteamAppId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }
  const directValue = parsePositiveIntegerInput(raw, 0);
  if (directValue > 0) {
    return directValue;
  }
  const fromAppPath = raw.match(/\/app\/(\d+)/i);
  if (fromAppPath?.[1]) {
    return parsePositiveIntegerInput(fromAppPath[1], 0);
  }
  const fromQuery = raw.match(/[?&](?:app|appid)=(\d+)/i);
  if (fromQuery?.[1]) {
    return parsePositiveIntegerInput(fromQuery[1], 0);
  }
  return 0;
}

function isGoogleDriveFolderLink(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return false;
  }
  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").toLowerCase();
    if (!host.includes("drive.google.com")) {
      return false;
    }
    return /\/folders\/[a-zA-Z0-9_-]+/i.test(parsed.pathname);
  } catch (_error) {
    return false;
  }
}

function extractGoogleDriveFileId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  if (/^[a-zA-Z0-9_-]{16,}$/.test(raw) && !raw.includes("/")) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").toLowerCase();
    const pathName = String(parsed.pathname || "");

    if (!host.includes("drive.google.com") && !host.includes("drive.usercontent.google.com")) {
      return "";
    }

    const byPath = pathName.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i)?.[1];
    if (byPath) {
      return byPath;
    }

    const byQuery =
      String(parsed.searchParams.get("id") || "").trim() ||
      String(parsed.searchParams.get("fileId") || "").trim();
    if (byQuery && /^[a-zA-Z0-9_-]{16,}$/.test(byQuery)) {
      return byQuery;
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function createDriveDownloadUrl(fileId, withConfirm = false) {
  const encodedId = encodeURIComponent(String(fileId || "").trim());
  const base = `https://drive.usercontent.google.com/download?id=${encodedId}&export=download&authuser=0`;
  return withConfirm ? `${base}&confirm=t` : base;
}

function createDriveDirectDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(String(fileId || "").trim())}`;
}

function createDownloadSources(gameId, fileId) {
  return [
    {
      url: createDriveDownloadUrl(fileId, false),
      label: `driveusercontent-${String(gameId || "").trim()}`,
      kind: "google-drive",
      priority: 5
    },
    {
      url: createDriveDownloadUrl(fileId, true),
      label: "driveusercontent-confirm",
      kind: "google-drive",
      priority: 6
    },
    {
      url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(String(fileId || "").trim())}`,
      label: "drive-uc-fallback",
      kind: "google-drive",
      priority: 8
    }
  ];
}

function parseSupabaseResponsePayload(rawText) {
  if (!rawText) {
    return null;
  }
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return null;
  }
}

function buildSupabaseErrorMessage(responsePayload, status, fallback = "Falha no Supabase.") {
  return (
    responsePayload?.message ||
    responsePayload?.error ||
    responsePayload?.details ||
    responsePayload?.hint ||
    `${fallback} (${status}).`
  );
}

function normalizeJsonArrayField(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function normalizeLauncherGameRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  return {
    id: readText(row.id),
    name: readText(row.name),
    section: readText(row.section, "Catalogo"),
    description: readText(row.description),
    long_description: readText(row.long_description),
    archive_type: normalizeArchiveType(row.archive_type),
    archive_password: readText(row.archive_password, "online-fix.me"),
    checksum_sha256: readText(row.checksum_sha256),
    download_url: readText(row.download_url),
    download_urls: normalizeJsonArrayField(row.download_urls),
    download_sources: normalizeJsonArrayField(row.download_sources),
    google_drive_file_id: readText(row.google_drive_file_id),
    local_archive_file: readText(row.local_archive_file),
    google_api_key: readText(row.google_api_key),
    install_dir_name: readText(row.install_dir_name),
    launch_executable: readText(row.launch_executable),
    auto_detect_executable: parseBooleanInput(row.auto_detect_executable, true),
    image_url: readText(row.image_url),
    card_image_url: readText(row.card_image_url),
    banner_url: readText(row.banner_url),
    logo_url: readText(row.logo_url),
    trailer_url: readText(row.trailer_url),
    developed_by: readText(row.developed_by),
    published_by: readText(row.published_by),
    release_date: readText(row.release_date),
    steam_app_id: parsePositiveIntegerInput(row.steam_app_id, 0),
    gallery: normalizeJsonArrayField(row.gallery),
    genres: normalizeJsonArrayField(row.genres),
    average_play_time: readText(row.average_play_time),
    average_achievement: readText(row.average_achievement),
    size_bytes: String(row.size_bytes ?? "").trim(),
    size_label: readText(row.size_label),
    store_type: readText(row.store_type),
    store_tag: readText(row.store_tag),
    current_price: readText(row.current_price),
    original_price: readText(row.original_price),
    discount_percent: readText(row.discount_percent),
    free: parseBooleanInput(row.free, false),
    exclusive: parseBooleanInput(row.exclusive, false),
    coming_soon: parseBooleanInput(row.coming_soon, false),
    enabled: parseBooleanInput(row.enabled, true),
    sort_order: parseIntegerInput(row.sort_order, 100),
    created_at: readText(row.created_at),
    updated_at: readText(row.updated_at)
  };
}

const LAUNCHER_GAMES_SELECT_COLUMNS = [
  "id",
  "name",
  "section",
  "description",
  "long_description",
  "archive_type",
  "archive_password",
  "checksum_sha256",
  "download_url",
  "download_urls",
  "download_sources",
  "google_drive_file_id",
  "local_archive_file",
  "google_api_key",
  "install_dir_name",
  "launch_executable",
  "auto_detect_executable",
  "image_url",
  "card_image_url",
  "banner_url",
  "logo_url",
  "trailer_url",
  "developed_by",
  "published_by",
  "release_date",
  "steam_app_id",
  "gallery",
  "genres",
  "average_play_time",
  "average_achievement",
  "size_bytes",
  "size_label",
  "store_type",
  "store_tag",
  "current_price",
  "original_price",
  "discount_percent",
  "free",
  "exclusive",
  "coming_soon",
  "enabled",
  "sort_order",
  "created_at",
  "updated_at"
].join(",");

const RUNTIME_FLAGS_SELECT_COLUMNS = ["id", "enabled", "title", "message", "data", "created_at", "updated_at"].join(",");
const MAINTENANCE_FLAG_ID = "maintenance_mode";

function parseObjectInput(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    // Ignore invalid JSON and use fallback.
  }
  return fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
}

function normalizeRuntimeFlagRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  return {
    id: readText(row.id),
    enabled: parseBooleanInput(row.enabled, false),
    title: readText(row.title, "Manutencao programada"),
    message: readText(row.message, "Pode haver instabilidades temporarias durante este periodo."),
    data: parseObjectInput(row.data, {}),
    created_at: readText(row.created_at),
    updated_at: readText(row.updated_at)
  };
}

function defaultMaintenanceFlag() {
  return {
    id: MAINTENANCE_FLAG_ID,
    enabled: false,
    title: "Manutencao programada",
    message: "Pode haver instabilidades temporarias durante este periodo.",
    data: {},
    created_at: "",
    updated_at: ""
  };
}

async function fetchLauncherGamesFromSupabase({ search = "", limit = 250 } = {}) {
  if (!config.supabaseUrl || !config.supabaseRestKey) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_games`);
  endpoint.searchParams.set("select", LAUNCHER_GAMES_SELECT_COLUMNS);
  endpoint.searchParams.set("order", "updated_at.desc");
  endpoint.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || 1, 1), 500)));

  const normalizedSearch = String(search || "")
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (normalizedSearch) {
    endpoint.searchParams.set("or", `(id.ilike.*${normalizedSearch}*,name.ilike.*${normalizedSearch}*)`);
  }

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      apikey: config.supabaseRestKey,
      Authorization: `Bearer ${config.supabaseRestKey}`,
      "Content-Type": "application/json"
    }
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);
  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status, "Falha ao listar jogos"));
  }

  const rows = Array.isArray(responsePayload) ? responsePayload : [];
  return rows.map(normalizeLauncherGameRow).filter(Boolean);
}

async function fetchLauncherGameByIdFromSupabase(gameId) {
  const normalizedId = slugify(gameId);
  if (!normalizedId) {
    return null;
  }
  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_games`);
  endpoint.searchParams.set("select", LAUNCHER_GAMES_SELECT_COLUMNS);
  endpoint.searchParams.set("id", `eq.${normalizedId}`);
  endpoint.searchParams.set("limit", "1");

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      apikey: config.supabaseRestKey,
      Authorization: `Bearer ${config.supabaseRestKey}`,
      "Content-Type": "application/json"
    }
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);
  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status, "Falha ao carregar jogo"));
  }
  if (!Array.isArray(responsePayload) || !responsePayload.length) {
    return null;
  }
  return normalizeLauncherGameRow(responsePayload[0]);
}

async function upsertLauncherGameInSupabase(gamePayload) {
  if (!config.supabaseUrl || !config.supabaseRestKey) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY) ou preencha config/auth.json."
    );
  }

  const response = await fetch(`${config.supabaseUrl}/rest/v1/launcher_games?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: config.supabaseRestKey,
      Authorization: `Bearer ${config.supabaseRestKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(gamePayload)
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);

  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status));
  }

  if (Array.isArray(responsePayload)) {
    return responsePayload[0] || gamePayload;
  }
  return responsePayload || gamePayload;
}

async function deleteLauncherGameInSupabase(gameId) {
  const normalizedId = slugify(gameId);
  if (!normalizedId) {
    throw new Error("ID de jogo invalido.");
  }
  if (!config.supabaseUrl || !config.supabaseRestKey) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_games`);
  endpoint.searchParams.set("id", `eq.${normalizedId}`);
  endpoint.searchParams.set("select", "id");

  const response = await fetch(endpoint.toString(), {
    method: "DELETE",
    headers: {
      apikey: config.supabaseRestKey,
      Authorization: `Bearer ${config.supabaseRestKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);
  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status, "Falha ao remover jogo"));
  }

  if (Array.isArray(responsePayload) && responsePayload.length === 0) {
    return false;
  }
  return true;
}

async function fetchRuntimeFlagFromSupabase(flagId) {
  const normalizedId = readText(flagId);
  if (!normalizedId) {
    return null;
  }
  if (!config.supabaseUrl || !config.supabaseRestKey) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_runtime_flags`);
  endpoint.searchParams.set("select", RUNTIME_FLAGS_SELECT_COLUMNS);
  endpoint.searchParams.set("id", `eq.${normalizedId}`);
  endpoint.searchParams.set("limit", "1");

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      apikey: config.supabaseRestKey,
      Authorization: `Bearer ${config.supabaseRestKey}`,
      "Content-Type": "application/json"
    }
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);
  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status, "Falha ao carregar runtime flag"));
  }

  if (!Array.isArray(responsePayload) || responsePayload.length === 0) {
    return null;
  }
  return normalizeRuntimeFlagRow(responsePayload[0]);
}

async function upsertRuntimeFlagInSupabase(flagPayload) {
  if (!config.supabaseUrl || !config.supabaseRestKey) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const response = await fetch(`${config.supabaseUrl}/rest/v1/launcher_runtime_flags?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: config.supabaseRestKey,
      Authorization: `Bearer ${config.supabaseRestKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(flagPayload)
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);
  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status, "Falha ao salvar runtime flag"));
  }

  if (Array.isArray(responsePayload)) {
    return normalizeRuntimeFlagRow(responsePayload[0]) || null;
  }
  return normalizeRuntimeFlagRow(responsePayload);
}

function normalizeSteamSummaryPlayer(player) {
  const steamId = String(player?.steamid || "").trim();
  if (!isValidSteamId(steamId)) {
    return null;
  }
  const displayName = String(player?.personaname || steamId).trim() || steamId;
  const avatar = String(player?.avatarfull || player?.avatarmedium || player?.avatar || "").trim();
  return {
    steamId,
    displayName,
    avatar,
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
  const safeSteamId = String(steamId || "").trim();
  if (!isValidSteamId(safeSteamId)) {
    return null;
  }
  const endpoint = `https://steamcommunity.com/profiles/${safeSteamId}/?xml=1`;
  try {
    const response = await fetch(endpoint, {
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
      displayName: displayName || safeSteamId,
      avatar: String(avatar || "").trim(),
      profileUrl: `https://steamcommunity.com/profiles/${safeSteamId}`
    };
  } catch (_error) {
    return null;
  }
}

async function fetchSteamProfilesBySteamIds(steamIds = []) {
  const ids = Array.from(
    new Set(
      (Array.isArray(steamIds) ? steamIds : [])
        .map((entry) => String(entry || "").trim())
        .filter((entry) => isValidSteamId(entry))
    )
  );
  if (ids.length === 0) {
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

  if (pending.length && config.steamApiKey) {
    for (let index = 0; index < pending.length; index += STEAM_SUMMARY_FETCH_LIMIT) {
      const batch = pending.slice(index, index + STEAM_SUMMARY_FETCH_LIMIT);
      if (!batch.length) continue;
      try {
        const endpoint = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
        endpoint.searchParams.set("key", config.steamApiKey);
        endpoint.searchParams.set("steamids", batch.join(","));

        const response = await fetch(endpoint.toString(), {
          method: "GET",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) {
          continue;
        }
        const json = await response.json().catch(() => null);
        const players = Array.isArray(json?.response?.players) ? json.response.players : [];
        const mappedById = new Map();
        for (const player of players) {
          const mapped = normalizeSteamSummaryPlayer(player);
          if (!mapped) continue;
          mappedById.set(mapped.steamId, mapped);
        }

        for (const steamId of batch) {
          const profile = mappedById.get(steamId);
          if (!profile) {
            continue;
          }
          steamProfileCache.set(steamId, {
            profile,
            expiresAt: now + STEAM_SUMMARY_CACHE_TTL_MS
          });
          result.set(steamId, profile);
        }
      } catch (_error) {
        // Ignore Steam profile fetch failures and keep panel usable.
      }
    }
  }

  const unresolvedIds = ids.filter((steamId) => !result.has(steamId));
  for (const steamId of unresolvedIds) {
    const fallbackProfile = await fetchSteamCommunityProfileBySteamId(steamId);
    if (!fallbackProfile) {
      continue;
    }
    steamProfileCache.set(steamId, {
      profile: fallbackProfile,
      expiresAt: now + STEAM_SUMMARY_CACHE_TTL_MS
    });
    result.set(steamId, fallbackProfile);
  }

  return result;
}

async function fetchSteamProfileBySteamId(steamId) {
  const map = await fetchSteamProfilesBySteamIds([steamId]);
  return map.get(String(steamId || "").trim()) || null;
}

async function enrichAdminsWithSteamProfiles(admins = []) {
  const list = Array.isArray(admins) ? admins : [];
  if (!list.length) {
    return [];
  }

  const profilesBySteamId = await fetchSteamProfilesBySteamIds(list.map((admin) => admin?.steamId));
  return list.map((admin) => {
    const steamId = String(admin?.steamId || "").trim();
    const profile = profilesBySteamId.get(steamId) || null;
    const fallbackName = String(admin?.staffName || steamId || "Staff").trim() || steamId;
    return {
      ...admin,
      staffName: profile?.displayName || fallbackName,
      steamProfile: profile
        ? {
            steamId: profile.steamId,
            displayName: profile.displayName,
            avatar: profile.avatar,
            profileUrl: profile.profileUrl
          }
        : {
            steamId,
            displayName: fallbackName,
            avatar: "",
            profileUrl: steamId ? `https://steamcommunity.com/profiles/${steamId}` : ""
          }
    };
  });
}

async function buildViewer(req) {
  const isAuthenticated = Boolean(req.user && isValidSteamId(req.user.steamId));
  const steamId = isAuthenticated ? String(req.user.steamId || "").trim() : "";
  let isAdmin = false;
  let adminError = "";
  let adminRecord = null;

  if (steamId) {
    try {
      adminRecord = await adminStore.getAdminBySteamId(steamId);
      isAdmin = Boolean(adminRecord);
    } catch (error) {
      adminError = error?.message || "Falha ao validar staff autorizado.";
      isAdmin = false;
    }
  }

  const role = isAdmin ? normalizeStaffRole(adminRecord?.staffRole, STAFF_ROLE.STAFF) : "";
  const permissions = isAdmin ? getRolePermissions(role) : getRolePermissions(STAFF_ROLE.STAFF);

  return {
    authenticated: isAuthenticated,
    isAdmin: Boolean(isAdmin),
    adminError,
    role,
    permissions,
    user: isAuthenticated
      ? {
          steamId,
          displayName: String(req.user.displayName || steamId),
          avatar: String(req.user.avatar || "")
        }
      : null
  };
}

function requireAuth(req, res, nextMiddleware) {
  void buildViewer(req)
    .then((viewer) => {
      if (!viewer.authenticated) {
        res.status(401).json({
          error: "not_authenticated",
          message: "Login obrigatorio."
        });
        return;
      }
      req.viewer = viewer;
      nextMiddleware();
    })
    .catch(nextMiddleware);
}

function requireAdmin(req, res, nextMiddleware) {
  void buildViewer(req)
    .then((viewer) => {
      if (!viewer.authenticated) {
        res.status(401).json({
          error: "not_authenticated",
          message: "Login obrigatorio."
        });
        return;
      }
      if (viewer.adminError) {
        res.status(503).json({
          error: "admin_storage_unavailable",
          message: viewer.adminError
        });
        return;
      }
      if (!viewer.isAdmin) {
        res.status(403).json({
          error: "forbidden",
          message: "Seu SteamID nao esta autorizado como administrador."
        });
        return;
      }
      req.viewer = viewer;
      nextMiddleware();
    })
    .catch(nextMiddleware);
}

function requirePermission(permissionName, fallbackMessage = "Voce nao tem permissao para esta acao.") {
  return (req, res, nextMiddleware) => {
    void buildViewer(req)
      .then((viewer) => {
        if (!viewer.authenticated) {
          res.status(401).json({
            error: "not_authenticated",
            message: "Login obrigatorio."
          });
          return;
        }
        if (viewer.adminError) {
          res.status(503).json({
            error: "admin_storage_unavailable",
            message: viewer.adminError
          });
          return;
        }
        if (!viewer.isAdmin) {
          res.status(403).json({
            error: "forbidden",
            message: "Seu SteamID nao esta autorizado como administrador."
          });
          return;
        }
        if (!hasPermission(viewer, permissionName)) {
          res.status(403).json({
            error: "forbidden_permission",
            message: fallbackMessage
          });
          return;
        }
        req.viewer = viewer;
        nextMiddleware();
      })
      .catch(nextMiddleware);
  };
}

function inferAdminErrorStatus(error, fallbackStatus = 400) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("nao encontrado")) {
    return 404;
  }
  if (message.includes("mantenha ao menos um staff")) {
    return 400;
  }
  if (message.includes("[admins_supabase_")) {
    return 502;
  }
  return fallbackStatus;
}

const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_GALLERY_IMAGE_UPLOAD_BYTES,
    files: 12
  },
  fileFilter: (_req, file, callback) => {
    if (!normalizeImageExtension(file)) {
      callback(new Error("Somente imagens .png, .jpg, .jpeg, .webp, .gif ou .avif sao aceitas."));
      return;
    }
    callback(null, true);
  }
});

const upload = multer({
  dest: config.uploadTempDir,
  limits: {
    fileSize: config.maxUploadBytes
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(String(file?.originalname || "")).toLowerCase();
    if (extension !== ".rar") {
      callback(new Error("Somente arquivos .rar sao aceitos."));
      return;
    }
    callback(null, true);
  }
});

const publishUpload = multer({
  dest: config.uploadTempDir,
  limits: {
    fileSize: config.maxUploadBytes
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(String(file?.originalname || "")).toLowerCase();
    if (![".rar", ".zip"].includes(extension)) {
      callback(new Error("Somente arquivos .rar ou .zip sao aceitos."));
      return;
    }
    callback(null, true);
  }
});

function createServer() {
  const app = express();
  app.disable("x-powered-by");

  // Initialize admin cache/bootstrap in background. Do not block /api/me.
  void ensureBackendReady().catch((error) => {
    console.warn("[origin-web-admin] background initialize failed:", error?.message || error);
  });

  app.use(express.json({ limit: "4mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, nextMiddleware) => {
    if (req.user?.steamId) {
      nextMiddleware();
      return;
    }

    const cookies = parseCookieHeader(req.headers?.cookie || "");
    const token = String(cookies[ADMIN_AUTH_COOKIE_NAME] || "").trim();
    if (!token) {
      nextMiddleware();
      return;
    }

    const restoredUser = readPersistentAuthToken(token);
    if (!restoredUser) {
      clearPersistentAuthCookie(res);
      nextMiddleware();
      return;
    }

    req.user = restoredUser;
    nextMiddleware();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "origin-web-admin",
      adminStorage: adminStore.mode,
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/runtime-flags/maintenance", requireAdmin, async (_req, res) => {
    try {
      const flag = (await fetchRuntimeFlagFromSupabase(MAINTENANCE_FLAG_ID)) || defaultMaintenanceFlag();
      res.json({
        ok: true,
        flag
      });
    } catch (error) {
      res.status(502).json({
        error: "maintenance_flag_load_failed",
        message: error?.message || "Falha ao carregar flag de manutencao."
      });
    }
  });

  app.patch(
    "/api/runtime-flags/maintenance",
    requirePermission("manageMaintenance", "Seu cargo nao pode alterar o modo manutencao."),
    async (req, res) => {
    try {
      const existingFlag = (await fetchRuntimeFlagFromSupabase(MAINTENANCE_FLAG_ID)) || defaultMaintenanceFlag();
      const payload = {
        id: MAINTENANCE_FLAG_ID,
        enabled: parseBooleanInput(req.body?.enabled, existingFlag.enabled),
        title: readText(req.body?.title, readText(existingFlag.title, defaultMaintenanceFlag().title)),
        message: readText(req.body?.message, readText(existingFlag.message, defaultMaintenanceFlag().message)),
        data: parseObjectInput(req.body?.data, existingFlag.data || {})
      };

      const savedFlag = (await upsertRuntimeFlagInSupabase(payload)) || {
        ...defaultMaintenanceFlag(),
        ...payload
      };

      res.json({
        ok: true,
        flag: savedFlag
      });
    } catch (error) {
      res.status(502).json({
        error: "maintenance_flag_save_failed",
        message: error?.message || "Falha ao salvar flag de manutencao."
      });
    }
    }
  );

  app.post(
    "/api/upload-gallery-image",
    requirePermission("publishGame", "Seu cargo nao pode enviar midias de jogo."),
    (req, res) => {
    galleryUpload.array("images", 12)(req, res, async (uploadError) => {
      if (uploadError) {
        if (uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({
            error: "image_too_large",
            message: "Cada imagem deve ter no maximo 5MB."
          });
          return;
        }
        res.status(400).json({
          error: "invalid_image_upload",
          message: String(uploadError?.message || "Falha no upload das imagens.")
        });
        return;
      }

      try {
        const files = Array.isArray(req.files) ? req.files : [];
        if (files.length === 0) {
          res.status(400).json({
            error: "missing_images",
            message: "Selecione ao menos uma imagem para upload."
          });
          return;
        }

        const urls = [];
        const hasDriveCredentials = Boolean(
          readText(config.googleServiceAccountJson) || readText(config.googleDriveKeyFile)
        );
        const canUseDriveUpload =
          Boolean(config.googleDriveEnabled) &&
          hasDriveCredentials &&
          typeof driveService.uploadFileBuffer === "function";
        const localPublicGalleryDir = path.join(config.siteRoot, "public", "uploads", "gallery");
        if (!canUseDriveUpload) {
          fs.mkdirSync(localPublicGalleryDir, { recursive: true });
        }
        for (const file of files) {
          const extension = normalizeImageExtension(file);
          if (!extension || !file.buffer) continue;
          const fileName = buildGalleryFileName(file.originalname, extension);
          if (canUseDriveUpload) {
            const uploaded = await driveService.uploadFileBuffer({
              buffer: file.buffer,
              fileName,
              mimeType: String(file.mimetype || "").trim() || undefined,
              folderSegments: ["gallery-images"]
            });
            const uploadedUrl = readText(uploaded?.publicUrl || uploaded?.viewUrl || uploaded?.downloadUrl);
            if (uploadedUrl) {
              urls.push(uploadedUrl);
            }
            continue;
          }

          const destination = path.join(localPublicGalleryDir, fileName);
          fs.writeFileSync(destination, file.buffer);
          urls.push(`/uploads/gallery/${encodeURIComponent(fileName)}`);
        }

        if (urls.length === 0) {
          res.status(400).json({
            error: "invalid_images",
            message: "Nao foi possivel processar as imagens enviadas."
          });
          return;
        }

        res.json({
          ok: true,
          urls
        });
      } catch (error) {
        res.status(500).json({
          error: "image_upload_failed",
          message: error instanceof Error ? error.message : "Falha ao salvar imagens da galeria."
        });
      }
    });
    }
  );

  app.post("/api/publish-game", requirePermission("publishGame", "Seu cargo nao pode publicar jogos."), publishUpload.single("archive"), async (req, res) => {
    const tempFilePath = String(req.file?.path || "");
    try {
      const id = slugify(req.body?.id || req.body?.name || "");
      const name = readText(req.body?.name);
      if (!id || !name) {
        res.status(400).json({
          error: "invalid_identity",
          message: "Preencha ID e nome do jogo."
        });
        return;
      }

      const existingGame = await fetchLauncherGameByIdFromSupabase(id);
      if (existingGame && !hasPermission(req.viewer, "editGame")) {
        res.status(403).json({
          error: "forbidden_permission",
          message: "Seu cargo pode criar jogos, mas nao pode editar jogos existentes."
        });
        return;
      }

      const archiveTypeFromFile =
        path.extname(String(req.file?.originalname || "")).toLowerCase() === ".zip" ? "zip" : "rar";
      const archiveType = normalizeArchiveType(
        req.body?.archiveType || req.body?.archive_type || existingGame?.archive_type || archiveTypeFromFile
      );

      let uploadResult = null;
      const driveLinkInput = readText(req.body?.driveLink || req.body?.drive_link);
      const hasFolderLinkInput = isGoogleDriveFolderLink(driveLinkInput);
      let driveFileId = readText(req.body?.driveFileId || req.body?.drive_file_id);
      if (!driveFileId && driveLinkInput) {
        driveFileId = readText(extractGoogleDriveFileId(driveLinkInput));
      }

      if (req.file?.path) {
        uploadResult = await driveService.uploadGameArchive({
          localFilePath: req.file.path,
          gameName: name,
          gameSlug: id,
          archiveType
        });
        driveFileId = readText(uploadResult?.archiveFileId);
      }

      const galleryInput = parseArrayInput(req.body?.gallery || req.body?.galleryUrls || req.body?.gallery_urls);
      const genresInput = parseArrayInput(req.body?.genres || req.body?.genreTags || req.body?.genre_tags);
      const downloadUrlsInput = parseArrayInput(req.body?.downloadUrls || req.body?.download_urls);
      if (!driveFileId && downloadUrlsInput.length > 0) {
        driveFileId = readText(extractGoogleDriveFileId(downloadUrlsInput[0]));
      }
      if (!driveFileId && existingGame?.google_drive_file_id) {
        driveFileId = readText(existingGame.google_drive_file_id);
      }
      if (!driveFileId) {
        res.status(400).json({
          error: "missing_drive_id",
          message: hasFolderLinkInput
            ? "Link de pasta detectado. Cole um link de arquivo do Google Drive (.rar/.zip), nao de pasta."
            : "Envie um .rar/.zip, informe driveFileId, ou cole um link de arquivo do Google Drive."
        });
        return;
      }
      const directDownloadUrl = createDriveDirectDownloadUrl(driveFileId);
      const gallery = galleryInput.length ? galleryInput : normalizeJsonArrayField(existingGame?.gallery);
      const genres = genresInput.length ? genresInput : normalizeJsonArrayField(existingGame?.genres);
      const downloadUrls = downloadUrlsInput.length
        ? downloadUrlsInput
        : driveLinkInput
          ? [directDownloadUrl]
        : normalizeJsonArrayField(existingGame?.download_urls);
      const sizeBytesRaw = readText(req.body?.sizeBytes || req.body?.size_bytes, readText(existingGame?.size_bytes));
      const sizeBytes = sizeBytesRaw || String(parsePositiveIntegerInput(req.file?.size, 0));
      const steamAppId =
        parsePositiveIntegerInput(req.body?.steamAppId || req.body?.steam_app_id, 0) ||
        extractSteamAppId(req.body?.steamUrl || req.body?.steam_url) ||
        parsePositiveIntegerInput(existingGame?.steam_app_id, 0);

      const gamePayload = {
        id,
        name,
        section: readText(req.body?.section, readText(existingGame?.section, "Catalogo")),
        description: readText(req.body?.description, readText(existingGame?.description)),
        long_description: readText(
          req.body?.longDescription || req.body?.long_description,
          readText(existingGame?.long_description)
        ),
        archive_type: archiveType,
        archive_password: readText(
          req.body?.archivePassword || req.body?.archive_password,
          readText(existingGame?.archive_password, "online-fix.me")
        ),
        checksum_sha256: readText(
          req.body?.checksumSha256 || req.body?.checksum_sha256,
          readText(existingGame?.checksum_sha256)
        ),
        download_url: readText(downloadUrls[0], createDriveDownloadUrl(driveFileId, false)),
        download_urls: downloadUrls,
        download_sources: createDownloadSources(id, driveFileId),
        google_drive_file_id: driveFileId,
        local_archive_file: readText(
          req.body?.localArchiveFile || req.body?.local_archive_file,
          readText(existingGame?.local_archive_file)
        ),
        google_api_key: readText(
          req.body?.googleApiKey || req.body?.google_api_key,
          readText(existingGame?.google_api_key)
        ),
        install_dir_name: readText(
          req.body?.installDirName || req.body?.install_dir_name,
          readText(existingGame?.install_dir_name, name)
        ),
        launch_executable: readText(
          req.body?.launchExecutable || req.body?.launch_executable,
          readText(existingGame?.launch_executable)
        ),
        auto_detect_executable: parseBooleanInput(
          req.body?.autoDetectExecutable || req.body?.auto_detect_executable,
          parseBooleanInput(existingGame?.auto_detect_executable, true)
        ),
        image_url: readText(req.body?.imageUrl || req.body?.image_url, readText(existingGame?.image_url)),
        card_image_url: readText(
          req.body?.cardImageUrl || req.body?.card_image_url,
          readText(existingGame?.card_image_url)
        ),
        banner_url: readText(req.body?.bannerUrl || req.body?.banner_url, readText(existingGame?.banner_url)),
        logo_url: readText(req.body?.logoUrl || req.body?.logo_url, readText(existingGame?.logo_url)),
        trailer_url: readText(req.body?.trailerUrl || req.body?.trailer_url, readText(existingGame?.trailer_url)),
        developed_by: readText(
          req.body?.developedBy || req.body?.developed_by,
          readText(existingGame?.developed_by)
        ),
        published_by: readText(
          req.body?.publishedBy || req.body?.published_by,
          readText(existingGame?.published_by, "WPlay Games - OnlineFix")
        ),
        release_date: readText(req.body?.releaseDate || req.body?.release_date, readText(existingGame?.release_date)),
        steam_app_id: steamAppId,
        gallery,
        genres,
        average_play_time: readText(
          req.body?.averagePlayTime || req.body?.average_play_time,
          readText(existingGame?.average_play_time)
        ),
        average_achievement: readText(
          req.body?.averageAchievement || req.body?.average_achievement,
          readText(existingGame?.average_achievement)
        ),
        size_bytes: sizeBytes,
        size_label: readText(req.body?.sizeLabel || req.body?.size_label, readText(existingGame?.size_label)),
        store_type: readText(req.body?.storeType || req.body?.store_type, readText(existingGame?.store_type)),
        store_tag: readText(req.body?.storeTag || req.body?.store_tag, readText(existingGame?.store_tag)),
        current_price: readText(
          req.body?.currentPrice || req.body?.current_price,
          readText(existingGame?.current_price, "Gratuito")
        ),
        original_price: readText(
          req.body?.originalPrice || req.body?.original_price,
          readText(existingGame?.original_price)
        ),
        discount_percent: readText(
          req.body?.discountPercent || req.body?.discount_percent,
          readText(existingGame?.discount_percent, "0%")
        ),
        free: parseBooleanInput(req.body?.free, parseBooleanInput(existingGame?.free, false)),
        exclusive: parseBooleanInput(req.body?.exclusive, parseBooleanInput(existingGame?.exclusive, false)),
        coming_soon: parseBooleanInput(
          req.body?.comingSoon || req.body?.coming_soon,
          parseBooleanInput(existingGame?.coming_soon, false)
        ),
        enabled: parseBooleanInput(req.body?.enabled, parseBooleanInput(existingGame?.enabled, true)),
        sort_order: parseIntegerInput(req.body?.sortOrder || req.body?.sort_order, parseIntegerInput(existingGame?.sort_order, 100))
      };

      const savedGame = await upsertLauncherGameInSupabase(gamePayload);

      res.json({
        ok: true,
        action: uploadResult ? "upload_and_save" : existingGame ? "update_metadata" : "create_metadata",
        savedAt: new Date().toISOString(),
        game: savedGame,
        upload: uploadResult
      });
    } catch (error) {
      res.status(500).json({
        error: "publish_failed",
        message: error.message || "Falha ao publicar jogo."
      });
    } finally {
      if (tempFilePath) {
        fs.unlink(tempFilePath, () => {});
      }
    }
  });

  app.get("/api/me", async (req, res, nextMiddleware) => {
    try {
      const viewer = await buildViewer(req);
      if (viewer.authenticated && viewer.user?.steamId) {
        setPersistentAuthCookie(res, viewer.user);
      } else {
        clearPersistentAuthCookie(res);
      }
      res.json({
        ...viewer,
        steamLoginReady: Boolean(config.steamApiKey),
        adminStorage: adminStore.mode
      });
    } catch (error) {
      nextMiddleware(error);
    }
  });

  app.post("/api/logout", requireAuth, (_req, res) => {
    clearPersistentAuthCookie(res);
    clearSteamAuthStateCookie(res);
    res.clearCookie("origin_admin_sid", getClearCookieOptions());
    res.json({ ok: true });
  });

  app.get("/api/auth/steam", (req, res) => {
    if (!config.steamApiKey) {
      res.redirect("/?error=steam-key-missing");
      return;
    }
    const baseUrl = resolveRequestBaseUrl(req);
    if (!baseUrl) {
      res.redirect("/?error=steam-login");
      return;
    }

    const stateToken = createSteamAuthStateToken();
    setSteamAuthStateCookie(res, stateToken);
    const returnToUrl = `${baseUrl}/api/auth/steam/return?state=${encodeURIComponent(stateToken)}`;
    res.redirect(buildSteamOpenIdRedirectUrl(returnToUrl, baseUrl));
  });

  app.get("/api/auth/steam/return", async (req, res) => {
    if (!config.steamApiKey) {
      res.redirect("/?error=steam-key-missing");
      return;
    }

    try {
      const query = toStringMap(req.query);
      const stateFromQuery = readText(query.state);
      const cookies = parseCookieHeader(req.headers?.cookie || "");
      const stateFromCookie = readText(cookies[STEAM_AUTH_STATE_COOKIE_NAME]);
      const statePayload = readSteamAuthStateToken(stateFromQuery);

      clearSteamAuthStateCookie(res);
      if (!statePayload || !stateFromCookie || stateFromCookie !== stateFromQuery) {
        clearPersistentAuthCookie(res);
        res.redirect("/?error=steam-callback");
        return;
      }

      const assertionValid = await verifySteamOpenIdAssertion(query);
      if (!assertionValid) {
        clearPersistentAuthCookie(res);
        res.redirect("/?error=steam-callback");
        return;
      }

      const claimedId = readText(query["openid.claimed_id"] || query["openid.identity"]);
      const steamId = extractSteamIdFromClaimedId(claimedId);
      if (!isValidSteamId(steamId)) {
        clearPersistentAuthCookie(res);
        res.redirect("/?error=steam-callback");
        return;
      }

      const profile = await fetchSteamProfileBySteamId(steamId);
      req.user = {
        steamId,
        displayName: readText(profile?.displayName, steamId),
        avatar: readText(profile?.avatar)
      };

      const viewer = await buildViewer(req);
      if (viewer.adminError) {
        clearPersistentAuthCookie(res);
        res.redirect("/?error=admin-storage");
        return;
      }
      if (!viewer.isAdmin) {
        clearPersistentAuthCookie(res);
        res.redirect("/?error=not-admin");
        return;
      }

      setPersistentAuthCookie(res, viewer.user);
      res.redirect("/?login=ok");
    } catch (_error) {
      clearPersistentAuthCookie(res);
      res.redirect("/?error=steam-callback");
    }
  });

  app.get("/auth/steam", (_req, res) => {
    res.redirect("/api/auth/steam");
  });

  app.get("/auth/steam/return", (req, res) => {
    const query = toStringMap(req.query);
    delete query.path;
    const params = new URLSearchParams(query);
    const suffix = params.toString();
    res.redirect(suffix ? `/api/auth/steam/return?${suffix}` : "/api/auth/steam/return");
  });

  app.get("/api/admins", requireAdmin, async (_req, res) => {
    try {
      const admins = await adminStore.listAdmins();
      const enrichedAdmins = await enrichAdminsWithSteamProfiles(admins);
      res.json({
        admins: enrichedAdmins
      });
    } catch (error) {
      res.status(inferAdminErrorStatus(error, 502)).json({
        error: "list_admins_failed",
        message: error.message || "Falha ao carregar staffs."
      });
    }
  });

  app.post("/api/admins", requirePermission("manageStaff", "Seu cargo nao pode adicionar staffs."), async (req, res) => {
    const steamId = String(req.body?.steamId || "").trim();
    if (!isValidSteamId(steamId)) {
      res.status(400).json({
        error: "invalid_steam_id",
        message: "SteamID invalido. Use 17 digitos."
      });
      return;
    }
    try {
      const steamProfile = await fetchSteamProfileBySteamId(steamId);
      const role = normalizeStaffRole(req.body?.staffRole || req.body?.role, STAFF_ROLE.STAFF);
      const admin = await adminStore.addAdmin({
        steamId,
        staffName: readText(steamProfile?.displayName, steamId),
        staffRole: role
      });
      const enrichedAdmins = await enrichAdminsWithSteamProfiles(await adminStore.listAdmins());
      const enrichedAdmin = enrichedAdmins.find((entry) => String(entry?.steamId || "") === steamId) || admin;
      res.json({
        ok: true,
        admin: enrichedAdmin,
        admins: enrichedAdmins
      });
    } catch (error) {
      res.status(inferAdminErrorStatus(error, 400)).json({
        error: "invalid_admin_payload",
        message: error.message || "Falha ao salvar staff."
      });
    }
  });

  app.patch(
    "/api/admins/:steamId",
    requirePermission("manageStaff", "Seu cargo nao pode alterar staffs."),
    async (req, res) => {
    const steamId = String(req.params?.steamId || "").trim();
    if (!isValidSteamId(steamId)) {
      res.status(400).json({
        error: "invalid_steam_id",
        message: "SteamID invalido."
      });
      return;
    }

    try {
      const steamProfile = await fetchSteamProfileBySteamId(steamId);
      const admin = await adminStore.updateAdmin(steamId, {
        staffName: readText(steamProfile?.displayName, steamId),
        staffRole: normalizeStaffRole(req.body?.staffRole || req.body?.role)
      });
      const enrichedAdmins = await enrichAdminsWithSteamProfiles(await adminStore.listAdmins());
      const enrichedAdmin = enrichedAdmins.find((entry) => String(entry?.steamId || "") === steamId) || admin;
      res.json({
        ok: true,
        admin: enrichedAdmin,
        admins: enrichedAdmins
      });
    } catch (error) {
      res.status(inferAdminErrorStatus(error, 404)).json({
        error: "admin_not_found",
        message: error.message || "Staff nao encontrado."
      });
    }
    }
  );

  app.delete(
    "/api/admins/:steamId",
    requirePermission("manageStaff", "Seu cargo nao pode remover staffs."),
    async (req, res) => {
    const steamId = String(req.params?.steamId || "").trim();
    if (!isValidSteamId(steamId)) {
      res.status(400).json({
        error: "invalid_steam_id",
        message: "SteamID invalido."
      });
      return;
    }
    try {
      const admins = await enrichAdminsWithSteamProfiles(await adminStore.removeAdmin(steamId));
      res.json({
        ok: true,
        admins
      });
    } catch (error) {
      const status = inferAdminErrorStatus(error, 400);
      res.status(status).json({
        error: status === 404 ? "admin_not_found" : "remove_admin_failed",
        message: error.message || "Falha ao remover staff."
      });
    }
    }
  );

  app.get("/api/launcher-games", requireAdmin, async (req, res) => {
    try {
      const search = readText(req.query?.search);
      const limit = parsePositiveIntegerInput(req.query?.limit, 250);
      const games = await fetchLauncherGamesFromSupabase({ search, limit });
      res.json({
        ok: true,
        total: games.length,
        games
      });
    } catch (error) {
      res.status(502).json({
        error: "list_launcher_games_failed",
        message: error?.message || "Falha ao carregar catalogo no Supabase."
      });
    }
  });

  app.delete(
    "/api/launcher-games/:id",
    requirePermission("removeGame", "Seu cargo nao pode remover jogos."),
    async (req, res) => {
      const gameId = slugify(req.params?.id);
      if (!gameId) {
        res.status(400).json({
          error: "invalid_game_id",
          message: "ID de jogo invalido."
        });
        return;
      }
      try {
        const deleted = await deleteLauncherGameInSupabase(gameId);
        if (!deleted) {
          res.status(404).json({
            error: "game_not_found",
            message: "Jogo nao encontrado."
          });
          return;
        }
        res.json({
          ok: true,
          gameId
        });
      } catch (error) {
        res.status(502).json({
          error: "remove_launcher_game_failed",
          message: error?.message || "Falha ao remover jogo."
        });
      }
    }
  );

  app.get("/api/games", requireAdmin, (_req, res) => {
    res.json({
      games: db.listGames()
    });
  });

  app.post("/api/games", requirePermission("publishGame", "Seu cargo nao pode cadastrar jogos."), (req, res) => {
    try {
      const game = db.upsertGame({
        name: req.body?.name,
        slug: req.body?.slug,
        description: req.body?.description
      });
      res.json({
        ok: true,
        game
      });
    } catch (error) {
      res.status(400).json({
        error: "invalid_game_payload",
        message: error.message || "Falha ao salvar jogo."
      });
    }
  });

  app.post(
    "/api/games/:slug/upload",
    requirePermission("publishGame", "Seu cargo nao pode enviar arquivos de jogo."),
    upload.single("archive"),
    async (req, res) => {
    const slug = slugify(req.params?.slug);
    if (!slug) {
      res.status(400).json({
        error: "invalid_slug",
        message: "Slug invalido."
      });
      return;
    }

    const game = db.getGameBySlug(slug);
    if (!game) {
      res.status(404).json({
        error: "game_not_found",
        message: "Jogo nao encontrado."
      });
      return;
    }

    if (!req.file?.path) {
      res.status(400).json({
        error: "missing_file",
        message: "Arquivo .rar obrigatorio."
      });
      return;
    }

    try {
      const uploadResult = await driveService.uploadGameArchive({
        localFilePath: req.file.path,
        gameName: game.name,
        gameSlug: game.slug
      });

      const updatedGame = db.setGameArchive(game.slug, uploadResult);
      res.json({
        ok: true,
        game: updatedGame,
        upload: uploadResult
      });
    } catch (error) {
      res.status(500).json({
        error: "drive_upload_failed",
        message: error.message || "Falha ao enviar arquivo ao Google Drive."
      });
    } finally {
      fs.unlink(req.file.path, () => {});
    }
    }
  );

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: "file_too_large",
        message: `Arquivo maior que o limite configurado (${config.uploadMaxMb} MB).`
      });
      return;
    }

    res.status(400).json({
      error: "request_error",
      message: error.message || "Falha na requisicao."
    });
  });

  return app;
}

module.exports = {
  createApiApp: createServer
};
