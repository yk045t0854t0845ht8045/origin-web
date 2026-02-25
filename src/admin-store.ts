// @ts-nocheck
const { isValidSteamId } = require("./utils");

function nowIso() {
  return new Date().toISOString();
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

function normalizeStaffRole(value, fallback = "staff") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["developer", "dev", "super-admin", "super_admin", "superadmin", "owner", "root"].includes(normalized)) {
    return "developer";
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
    return "administrador";
  }
  return "staff";
}

function normalizeAdminPayload(input) {
  if (typeof input === "string") {
    return {
      steamId: String(input).trim(),
      staffName: "Staff",
      staffRole: "staff"
    };
  }

  const fallbackRole = normalizeStaffRole(
    input?.currentStaffRole || input?.current_staff_role || input?.fallbackRole || input?.fallback_role || "staff",
    "staff"
  );
  return {
    steamId: String(input?.steamId || input?.steam_id || "").trim(),
    staffName: sanitizeStaffText(input?.staffName || input?.staff_name || input?.name || "", "Staff"),
    staffRole: normalizeStaffRole(input?.staffRole || input?.staff_role || input?.role || "", fallbackRole),
    createdAt: String(input?.createdAt || input?.created_at || "").trim(),
    updatedAt: String(input?.updatedAt || input?.updated_at || "").trim()
  };
}

function mapSupabaseAdminRow(row) {
  if (!row) {
    return null;
  }
  const normalized = normalizeAdminPayload(row);
  if (!isValidSteamId(normalized.steamId)) {
    return null;
  }
  const createdAt = normalized.createdAt || nowIso();
  const updatedAt = normalized.updatedAt || createdAt;
  return {
    steamId: normalized.steamId,
    staffName: normalized.staffName || "Staff",
    staffRole: normalizeStaffRole(normalized.staffRole, "staff"),
    createdAt,
    updatedAt
  };
}

function buildSupabaseHeaders(config, hasBody, prefer = "") {
  const apiKey = String(config.supabaseRestKey || config.supabaseAnonKey || "").trim();
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Accept-Profile": config.adminsSupabaseSchema
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
    headers["Content-Profile"] = config.adminsSupabaseSchema;
  }
  if (prefer) {
    headers.Prefer = prefer;
  }
  return headers;
}

function buildSupabaseUrl(config, query = {}) {
  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/${config.adminsSupabaseTable}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    endpoint.searchParams.set(key, String(value));
  }
  return endpoint.toString();
}

function parseJsonSafe(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function formatSupabaseError(status, payload, rawText, context, config) {
  const parts = [];
  if (payload?.message) {
    parts.push(String(payload.message));
  }
  if (payload?.details) {
    parts.push(String(payload.details));
  }
  if (payload?.hint) {
    parts.push(String(payload.hint));
  }
  if (!parts.length && rawText) {
    parts.push(String(rawText).slice(0, 240));
  }
  if (!parts.length) {
    parts.push(`Falha HTTP ${status}`);
  }

  if (status === 401 || status === 403) {
    parts.push(
      `Verifique permissoes RLS para ${config.adminsSupabaseSchema}.${config.adminsSupabaseTable} (select/insert/update/delete) ou configure SUPABASE_SERVICE_ROLE_KEY no backend.`
    );
  }
  return `[ADMINS_SUPABASE_${context}_HTTP_${status}] ${parts.join(" | ")}`;
}

const SUPABASE_REQUEST_TIMEOUT_MS = 8000;

async function requestSupabase(config, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const hasBody = options.body !== undefined;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(buildSupabaseUrl(config, options.query), {
      method,
      headers: buildSupabaseHeaders(config, hasBody, options.prefer || ""),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `[ADMINS_SUPABASE_${String(options.context || method).toUpperCase()}_TIMEOUT] Supabase nao respondeu em ${
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
        String(options.context || method).toUpperCase(),
        config
      )
    );
  }

  return {
    status: response.status,
    payload
  };
}

function createAdminStore(config, db) {
  const providerRaw = String(config.adminsProvider || "auto")
    .trim()
    .toLowerCase();
  const remoteConfigured = Boolean(config.supabaseUrl && (config.supabaseRestKey || config.supabaseAnonKey));
  const isLocalProvider = providerRaw === "local" || providerRaw === "sqlite";
  const useSupabase = !isLocalProvider && (providerRaw === "supabase" || (providerRaw === "auto" && remoteConfigured));
  const mode = useSupabase ? "supabase" : "local";

  function syncLocalSnapshot(admins) {
    if (!Array.isArray(admins)) {
      return;
    }
    try {
      if (typeof db.replaceAdmins === "function") {
        db.replaceAdmins(admins);
      }
    } catch (_error) {
      // Mirror cache should not block remote flow.
    }
  }

  function upsertLocalSnapshot(admin) {
    if (!admin) {
      return;
    }
    try {
      if (typeof db.upsertAdminSnapshot === "function") {
        db.upsertAdminSnapshot(admin);
      }
    } catch (_error) {
      // Mirror cache should not block remote flow.
    }
  }

  async function fetchRemoteAdmins() {
    const response = await requestSupabase(config, {
      method: "GET",
      context: "list",
      query: {
        select: "steam_id,staff_name,staff_role,created_at,updated_at",
        order: "created_at.asc"
      }
    });
    return Array.isArray(response.payload) ? response.payload.map(mapSupabaseAdminRow).filter(Boolean) : [];
  }

  async function getRemoteAdminBySteamId(steamId) {
    const response = await requestSupabase(config, {
      method: "GET",
      context: "find",
      query: {
        select: "steam_id,staff_name,staff_role,created_at,updated_at",
        steam_id: `eq.${steamId}`,
        limit: "1"
      }
    });
    if (!Array.isArray(response.payload) || !response.payload.length) {
      return null;
    }
    return mapSupabaseAdminRow(response.payload[0]);
  }

  async function insertMissingBootstrapAdmins(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) {
      return;
    }
    const normalizedEntries = list
      .map((entry) => normalizeAdminPayload(entry))
      .filter((entry) => isValidSteamId(entry.steamId));
    if (!normalizedEntries.length) {
      return;
    }

    const remoteAdmins = await fetchRemoteAdmins();
    const existingIds = new Set(remoteAdmins.map((entry) => entry.steamId));
    const timestamp = nowIso();
    const missingRows = normalizedEntries
      .filter((entry) => !existingIds.has(entry.steamId))
      .map((entry) => ({
        steam_id: entry.steamId,
        staff_name: entry.staffName || "Staff",
        staff_role: entry.staffRole || "staff",
        created_at: timestamp,
        updated_at: timestamp
      }));

    if (!missingRows.length) {
      return;
    }

    try {
      await requestSupabase(config, {
        method: "POST",
        context: "bootstrap",
        query: {
          on_conflict: "steam_id"
        },
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: missingRows
      });
    } catch (error) {
      const message = String(error?.message || "");
      const isPolicyError =
        message.includes("[ADMINS_SUPABASE_BOOTSTRAP_HTTP_401]") ||
        message.includes("[ADMINS_SUPABASE_BOOTSTRAP_HTTP_403]");
      if (!isPolicyError) {
        throw error;
      }
      console.warn(
        "[origin-web-admin] admin bootstrap ignorado por policy RLS (insert bloqueado). " +
          "Use SUPABASE_SERVICE_ROLE_KEY no backend ou crie policy de insert."
      );
    }
  }

  async function initialize() {
    if (mode === "local") {
      return;
    }
    if (!remoteConfigured) {
      throw new Error(
        "[ADMINS_SUPABASE_NOT_CONFIGURED] Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY) para usar admins no Supabase."
      );
    }
    await insertMissingBootstrapAdmins(config.bootstrapAdmins);
    const admins = await fetchRemoteAdmins();
    syncLocalSnapshot(admins);
  }

  async function listAdmins() {
    if (mode === "local") {
      return db.listAdmins();
    }
    const admins = await fetchRemoteAdmins();
    syncLocalSnapshot(admins);
    return admins;
  }

  async function countAdmins() {
    if (mode === "local") {
      return db.countAdmins();
    }
    const admins = await fetchRemoteAdmins();
    syncLocalSnapshot(admins);
    return admins.length;
  }

  async function getAdminBySteamId(steamId) {
    const normalizedSteamId = String(steamId || "").trim();
    if (!isValidSteamId(normalizedSteamId)) {
      return null;
    }
    if (mode === "local") {
      return db.getAdminBySteamId(normalizedSteamId);
    }
    const admin = await getRemoteAdminBySteamId(normalizedSteamId);
    if (admin) {
      upsertLocalSnapshot(admin);
    }
    return admin;
  }

  async function isAdmin(steamId) {
    return Boolean(await getAdminBySteamId(steamId));
  }

  async function addAdmin(payload) {
    const normalized = normalizeAdminPayload(payload);
    if (!isValidSteamId(normalized.steamId)) {
      throw new Error("SteamID invalido.");
    }
    if (mode === "local") {
      return db.addAdmin(normalized);
    }

    const existingAdmin = await getRemoteAdminBySteamId(normalized.steamId);
    const timestamp = nowIso();
    const response = await requestSupabase(config, {
      method: "POST",
      context: "upsert",
      query: {
        on_conflict: "steam_id",
        select: "steam_id,staff_name,staff_role,created_at,updated_at"
      },
      prefer: "resolution=merge-duplicates,return=representation",
      body: [
        {
          steam_id: normalized.steamId,
          staff_name: normalized.staffName || "Staff",
          staff_role: normalizeStaffRole(normalized.staffRole, "staff"),
          created_at: existingAdmin?.createdAt || timestamp,
          updated_at: timestamp
        }
      ]
    });

    const admin = mapSupabaseAdminRow(Array.isArray(response.payload) ? response.payload[0] : null);
    if (!admin) {
      throw new Error("Falha ao salvar staff no Supabase.");
    }
    upsertLocalSnapshot(admin);
    return admin;
  }

  async function updateAdmin(steamId, payload) {
    const normalizedSteamId = String(steamId || "").trim();
    if (!isValidSteamId(normalizedSteamId)) {
      throw new Error("SteamID invalido.");
    }
    if (mode === "local") {
      return db.updateAdmin(normalizedSteamId, payload);
    }

    const currentAdmin = await getRemoteAdminBySteamId(normalizedSteamId);
    if (!currentAdmin) {
      throw new Error("Staff nao encontrado.");
    }

    const staffName = sanitizeStaffText(
      payload?.staffName || payload?.staff_name || payload?.name || "",
      currentAdmin.staffName
    );
    const staffRole = normalizeStaffRole(
      payload?.staffRole || payload?.staff_role || payload?.role || "",
      currentAdmin.staffRole
    );

    const response = await requestSupabase(config, {
      method: "PATCH",
      context: "update",
      query: {
        steam_id: `eq.${normalizedSteamId}`,
        select: "steam_id,staff_name,staff_role,created_at,updated_at"
      },
      prefer: "return=representation",
      body: {
        staff_name: staffName,
        staff_role: staffRole,
        updated_at: nowIso()
      }
    });

    const admin = mapSupabaseAdminRow(Array.isArray(response.payload) ? response.payload[0] : null);
    if (!admin) {
      throw new Error("Staff nao encontrado.");
    }
    upsertLocalSnapshot(admin);
    return admin;
  }

  async function removeAdmin(steamId) {
    const normalizedSteamId = String(steamId || "").trim();
    if (!isValidSteamId(normalizedSteamId)) {
      throw new Error("SteamID invalido.");
    }
    if (mode === "local") {
      db.removeAdmin(normalizedSteamId);
      return db.listAdmins();
    }

    const adminsBeforeDelete = await fetchRemoteAdmins();
    if (adminsBeforeDelete.length <= 1) {
      throw new Error("Mantenha ao menos um staff autorizado.");
    }

    await requestSupabase(config, {
      method: "DELETE",
      context: "delete",
      query: {
        steam_id: `eq.${normalizedSteamId}`
      },
      prefer: "return=minimal"
    });

    const admins = await fetchRemoteAdmins();
    syncLocalSnapshot(admins);
    return admins;
  }

  return {
    mode,
    normalizeStaffRole,
    initialize,
    listAdmins,
    countAdmins,
    getAdminBySteamId,
    isAdmin,
    addAdmin,
    updateAdmin,
    removeAdmin
  };
}

module.exports = {
  createAdminStore
};
