const fs = require("fs");
const path = require("path");

function parseBoolean(value, fallback = false) {
  const normalized = String(value || "")
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

function parsePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.floor(parsed);
}

function parseList(value) {
  return String(value || "")
    .split(/[,\n;\s]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sanitizeLabel(value, fallback = "") {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 80);
}

function parseBootstrapAdminTable(value) {
  const rows = String(value || "")
    .split(/\r?\n|,/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const admins = [];
  for (const row of rows) {
    const [steamId, staffName, staffRole] = row.split("|").map((entry) => entry.trim());
    if (!steamId) {
      continue;
    }
    admins.push({
      steamId,
      staffName,
      staffRole
    });
  }
  return admins;
}

function parseBootstrapAdminsJson(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((entry) => ({
      steamId: String(entry?.steamId || "").trim(),
      staffName: String(entry?.staffName || entry?.name || "").trim(),
      staffRole: String(entry?.staffRole || entry?.role || "").trim()
    }));
  } catch (_error) {
    return [];
  }
}

function mergeBootstrapAdmins(entries) {
  const bySteamId = new Map();
  for (const entry of entries) {
    const steamId = String(entry?.steamId || entry || "").trim();
    if (!isSteamId(steamId)) {
      continue;
    }
    const current = bySteamId.get(steamId) || {
      steamId,
      staffName: "",
      staffRole: ""
    };
    bySteamId.set(steamId, {
      steamId,
      staffName: sanitizeLabel(entry?.staffName || current.staffName || "", ""),
      staffRole: sanitizeLabel(entry?.staffRole || current.staffRole || "", "")
    });
  }
  return Array.from(bySteamId.values()).map((entry) => ({
    steamId: entry.steamId,
    staffName: entry.staffName || "Staff",
    staffRole: entry.staffRole || "staff"
  }));
}

function normalizeBaseUrl(value, port) {
  const raw = String(value || "").trim();
  if (!raw) {
    return `http://localhost:${port}`;
  }
  try {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, "");
  } catch (_error) {
    return `http://localhost:${port}`;
  }
}

function normalizeDriveFolderId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "root";
  }
  if (raw === "root") {
    return "root";
  }
  if (!/^https?:\/\//i.test(raw)) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    const fromPath = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/i)?.[1];
    if (fromPath) {
      return fromPath;
    }
    const fromQuery = String(parsed.searchParams.get("id") || "").trim();
    if (fromQuery) {
      return fromQuery;
    }
  } catch (_error) {
    return raw;
  }

  return raw;
}

function isSteamId(value) {
  return /^\d{17}$/.test(String(value || "").trim());
}

function loadAuthConfig(siteRoot) {
  const authPath = path.resolve(siteRoot, "..", "config", "auth.json");
  if (!fs.existsSync(authPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      supabaseUrl: String(parsed?.supabaseUrl || "").trim(),
      supabaseAnonKey: String(parsed?.supabaseAnonKey || "").trim()
    };
  } catch (_error) {
    return {};
  }
}

const siteRoot = path.resolve(__dirname, "..");
const dataDir = path.join(siteRoot, "data");
const uploadTempDir = path.join(siteRoot, "uploads-temp");
const authConfig = loadAuthConfig(siteRoot);

const port = parsePositiveInteger(process.env.PORT, 4080);
const baseUrl = normalizeBaseUrl(process.env.BASE_URL, port);
const sessionSecret = String(process.env.SESSION_SECRET || "change-me-origin-web-admin").trim();
const steamApiKey = String(process.env.STEAM_API_KEY || "").trim();

const defaultAdminIds = ["76561199481226329"];
const envAdminIds = parseList(process.env.SITE_BOOTSTRAP_ADMIN_IDS || "").map((steamId) => ({
  steamId
}));
const envAdminTable = parseBootstrapAdminTable(process.env.SITE_BOOTSTRAP_ADMIN_TABLE || "");
const envAdminJson = parseBootstrapAdminsJson(process.env.SITE_BOOTSTRAP_ADMINS_JSON || "");
const bootstrapAdmins = mergeBootstrapAdmins([
  ...defaultAdminIds.map((steamId) => ({
    steamId,
    staffName: "Owner",
    staffRole: "super-admin"
  })),
  ...envAdminIds,
  ...envAdminTable,
  ...envAdminJson
]);
const bootstrapAdminIds = bootstrapAdmins.map((entry) => entry.steamId);

const googleDriveEnabled = parseBoolean(process.env.GOOGLE_DRIVE_ENABLED, true);
const googleDriveRootFolderId = normalizeDriveFolderId(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "root");
const googleDrivePathPrefix = (() => {
  const raw = process.env.GOOGLE_DRIVE_PATH_PREFIX;
  if (raw === undefined) {
    return "Origin Launcher";
  }
  return String(raw)
    .trim()
    .replace(/^\/+|\/+$/g, "");
})();
const googleDrivePublicLink = parseBoolean(process.env.GOOGLE_DRIVE_PUBLIC_LINK, false);
const googleDriveKeyFile = String(process.env.GOOGLE_DRIVE_KEY_FILE || "").trim();
const googleServiceAccountJson = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
const supabaseUrl = String(process.env.SUPABASE_URL || authConfig.supabaseUrl || "")
  .trim()
  .replace(/\/+$/g, "");
const supabaseAnonKey = String(
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || authConfig.supabaseAnonKey || ""
).trim();
const supabaseServiceRoleKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ""
).trim();
const supabaseRestKey = String(supabaseServiceRoleKey || supabaseAnonKey).trim();
const adminsProviderRaw = String(process.env.SITE_ADMINS_PROVIDER || "auto")
  .trim()
  .toLowerCase();
const adminsProvider = ["auto", "supabase", "local", "sqlite"].includes(adminsProviderRaw)
  ? adminsProviderRaw
  : "auto";
const adminsSupabaseSchema = String(process.env.SITE_ADMINS_SUPABASE_SCHEMA || "public").trim() || "public";
const adminsSupabaseTable =
  String(process.env.SITE_ADMINS_SUPABASE_TABLE || "admin_steam_ids").trim() || "admin_steam_ids";
const uploadMaxMb = parsePositiveInteger(process.env.UPLOAD_MAX_MB, 2048);
const maxUploadBytes = uploadMaxMb * 1024 * 1024;

module.exports = {
  siteRoot,
  dataDir,
  uploadTempDir,
  dbPath: path.join(dataDir, "site.db"),
  port,
  baseUrl,
  sessionSecret,
  steamApiKey,
  bootstrapAdmins,
  bootstrapAdminIds,
  googleDriveEnabled,
  googleDriveRootFolderId,
  googleDrivePathPrefix,
  googleDrivePublicLink,
  googleDriveKeyFile,
  googleServiceAccountJson,
  supabaseUrl,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseRestKey,
  adminsProvider,
  adminsSupabaseSchema,
  adminsSupabaseTable,
  uploadMaxMb,
  maxUploadBytes
};
