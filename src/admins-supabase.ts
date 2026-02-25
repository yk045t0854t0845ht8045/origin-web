// @ts-nocheck
const config = require("./config");
const { fetchSteamProfilesBySteamIds } = require("./auth-core");
const { isValidSteamId } = require("./utils");

const SUPABASE_REQUEST_TIMEOUT_MS = 5000;

function nowIso() {
  return new Date().toISOString();
}

function readText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeRole(value, fallback = "staff") {
  const role = readText(value).toLowerCase();
  if (!role) return fallback;
  if (["developer", "dev", "super-admin", "super_admin", "superadmin", "owner", "root"].includes(role)) {
    return "developer";
  }
  if (["administrador", "admin", "administrator", "administrador(a)", "moderator", "mod", "manager", "gerente"].includes(role)) {
    return "administrador";
  }
  return "staff";
}

function sanitizeStaffText(value, fallback = "") {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 80);
}

function getSupabaseConfig() {
  const url = readText(config.supabaseUrl).replace(/\/+$/g, "");
  const key = readText(config.supabaseRestKey || config.supabaseAnonKey);
  const schema = readText(config.adminsSupabaseSchema, "public");
  const table = readText(config.adminsSupabaseTable, "admin_steam_ids");
  return { url, key, schema, table };
}

function assertSupabaseConfig() {
  const current = getSupabaseConfig();
  if (!current.url || !current.key) {
    throw new Error(
      "Supabase admins nao configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY)."
    );
  }
  return current;
}

function buildSupabaseUrl(currentConfig, query = {}) {
  const endpoint = new URL(`${currentConfig.url}/rest/v1/${currentConfig.table}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    endpoint.searchParams.set(key, String(value));
  }
  return endpoint.toString();
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function buildSupabaseHeaders(currentConfig, hasBody = false, prefer = "") {
  const headers = {
    apikey: currentConfig.key,
    Authorization: `Bearer ${currentConfig.key}`,
    Accept: "application/json",
    "Accept-Profile": currentConfig.schema
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
    headers["Content-Profile"] = currentConfig.schema;
  }
  if (prefer) {
    headers.Prefer = prefer;
  }
  return headers;
}

function formatSupabaseError(status, payload, rawText, context) {
  const parts = [];
  if (payload?.message) parts.push(String(payload.message));
  if (payload?.details) parts.push(String(payload.details));
  if (payload?.hint) parts.push(String(payload.hint));
  if (!parts.length && rawText) parts.push(String(rawText).slice(0, 240));
  if (!parts.length) parts.push(`Falha HTTP ${status}`);
  return `[ADMINS_SUPABASE_${context}_HTTP_${status}] ${parts.join(" | ")}`;
}

async function requestSupabase(options = {}) {
  const current = assertSupabaseConfig();
  const method = readText(options.method, "GET").toUpperCase();
  const hasBody = options.body !== undefined;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(buildSupabaseUrl(current, options.query), {
      method,
      headers: buildSupabaseHeaders(current, hasBody, options.prefer || ""),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `[ADMINS_SUPABASE_${readText(options.context, method).toUpperCase()}_TIMEOUT] Supabase nao respondeu em ${
          SUPABASE_REQUEST_TIMEOUT_MS / 1000
        }s.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  const payload = parseJsonSafe(rawText);
  if (!response.ok) {
    throw new Error(
      formatSupabaseError(
        response.status,
        payload,
        rawText,
        readText(options.context, method).toUpperCase()
      )
    );
  }

  return {
    status: response.status,
    payload
  };
}

function mapAdminRow(row) {
  if (!row) return null;

  const steamId = readText(row.steam_id || row.steamId);
  if (!isValidSteamId(steamId)) {
    return null;
  }

  const createdAt = readText(row.created_at || row.createdAt, nowIso());
  const updatedAt = readText(row.updated_at || row.updatedAt, createdAt);
  return {
    steamId,
    staffName: sanitizeStaffText(readText(row.staff_name || row.staffName, "Staff"), "Staff"),
    staffRole: normalizeRole(row.staff_role || row.staffRole, "staff"),
    createdAt,
    updatedAt
  };
}

function bootstrapAdminsFallback() {
  const rows = Array.isArray(config.bootstrapAdmins) ? config.bootstrapAdmins : [];
  const now = nowIso();
  return rows
    .map((entry) => ({
      steam_id: readText(entry?.steamId),
      staff_name: readText(entry?.staffName, "Staff"),
      staff_role: normalizeRole(entry?.staffRole || entry?.role, "staff"),
      created_at: now,
      updated_at: now
    }))
    .map(mapAdminRow)
    .filter(Boolean);
}

async function listAdminsFromSupabase() {
  try {
    const response = await requestSupabase({
      method: "GET",
      context: "list",
      query: {
        select: "steam_id,staff_name,staff_role,created_at,updated_at",
        order: "created_at.asc"
      }
    });
    return Array.isArray(response.payload) ? response.payload.map(mapAdminRow).filter(Boolean) : [];
  } catch (error) {
    if (String(error?.message || "").includes("nao configurado")) {
      return bootstrapAdminsFallback();
    }
    throw error;
  }
}

async function upsertAdminInSupabase(payload) {
  const steamId = readText(payload?.steamId);
  if (!isValidSteamId(steamId)) {
    throw new Error("SteamID invalido.");
  }

  const response = await requestSupabase({
    method: "POST",
    context: "upsert",
    query: {
      on_conflict: "steam_id",
      select: "steam_id,staff_name,staff_role,created_at,updated_at"
    },
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        steam_id: steamId,
        staff_name: sanitizeStaffText(payload?.staffName, "Staff"),
        staff_role: normalizeRole(payload?.staffRole, "staff"),
        created_at: readText(payload?.createdAt, nowIso()),
        updated_at: nowIso()
      }
    ]
  });

  const row = Array.isArray(response.payload) ? response.payload[0] : null;
  return mapAdminRow(row);
}

async function updateAdminInSupabase(steamId, payload) {
  const normalizedSteamId = readText(steamId);
  if (!isValidSteamId(normalizedSteamId)) {
    throw new Error("SteamID invalido.");
  }

  const response = await requestSupabase({
    method: "PATCH",
    context: "update",
    query: {
      steam_id: `eq.${normalizedSteamId}`,
      select: "steam_id,staff_name,staff_role,created_at,updated_at"
    },
    prefer: "return=representation",
    body: {
      staff_name: sanitizeStaffText(payload?.staffName, "Staff"),
      staff_role: normalizeRole(payload?.staffRole, "staff"),
      updated_at: nowIso()
    }
  });

  const row = Array.isArray(response.payload) ? response.payload[0] : null;
  const admin = mapAdminRow(row);
  if (!admin) {
    throw new Error("Staff nao encontrado.");
  }
  return admin;
}

async function removeAdminInSupabase(steamId) {
  const normalizedSteamId = readText(steamId);
  if (!isValidSteamId(normalizedSteamId)) {
    throw new Error("SteamID invalido.");
  }

  const adminsBeforeDelete = await listAdminsFromSupabase();
  if (adminsBeforeDelete.length <= 1) {
    throw new Error("Mantenha ao menos um staff autorizado.");
  }

  await requestSupabase({
    method: "DELETE",
    context: "delete",
    query: {
      steam_id: `eq.${normalizedSteamId}`
    },
    prefer: "return=minimal"
  });

  return listAdminsFromSupabase();
}

async function enrichAdminsWithSteamProfiles(admins = []) {
  const list = Array.isArray(admins) ? admins : [];
  if (!list.length) {
    return [];
  }

  const steamIds = list.map((entry) => readText(entry?.steamId)).filter((entry) => isValidSteamId(entry));
  const profiles = await fetchSteamProfilesBySteamIds(steamIds);

  return list.map((admin) => {
    const steamId = readText(admin?.steamId);
    const profile = profiles.get(steamId) || null;
    const fallbackName = readText(admin?.staffName, steamId || "Staff");
    return {
      ...admin,
      staffName: readText(profile?.displayName, fallbackName),
      steamProfile: {
        steamId,
        displayName: readText(profile?.displayName, fallbackName),
        avatar: readText(profile?.avatar),
        profileUrl: readText(profile?.profileUrl, steamId ? `https://steamcommunity.com/profiles/${steamId}` : "")
      }
    };
  });
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

module.exports = {
  readText,
  normalizeRole,
  inferAdminErrorStatus,
  listAdminsFromSupabase,
  upsertAdminInSupabase,
  updateAdminInSupabase,
  removeAdminInSupabase,
  enrichAdminsWithSteamProfiles
};

