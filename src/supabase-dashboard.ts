// @ts-nocheck
const config = require("./config");
const { slugify } = require("./utils");

const SUPABASE_FETCH_TIMEOUT_MS = 6000;
const SUPABASE_FETCH_RETRIES = 0;

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
  "local_archive_file",
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

const launcherGamesCache = {
  data: [],
  updatedAt: 0
};

function readText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseBooleanInput(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return Boolean(fallback);
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return Boolean(fallback);
}

function parseIntegerInput(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback) || 0;
  return Math.trunc(parsed);
}

function parsePositiveIntegerInput(value, fallback = 0) {
  const parsed = parseIntegerInput(value, fallback);
  return parsed > 0 ? parsed : Math.max(0, Number(fallback) || 0);
}

function normalizeArchiveType(value) {
  return String(value || "rar")
    .trim()
    .toLowerCase() === "zip"
    ? "zip"
    : "rar";
}

function parseSupabaseResponsePayload(rawText) {
  if (!rawText) return null;
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
    // Ignore malformed JSON.
  }
  return fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
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
    local_archive_file: readText(row.local_archive_file),
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

function compareLauncherGamesBySortOrder(left, right) {
  const leftOrder = parseIntegerInput(left?.sort_order, 1_000_000);
  const rightOrder = parseIntegerInput(right?.sort_order, 1_000_000);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftUpdatedAt = Date.parse(readText(left?.updated_at));
  const rightUpdatedAt = Date.parse(readText(right?.updated_at));
  const safeLeftUpdatedAt = Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : 0;
  const safeRightUpdatedAt = Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : 0;
  if (safeRightUpdatedAt !== safeLeftUpdatedAt) {
    return safeRightUpdatedAt - safeLeftUpdatedAt;
  }

  const leftName = readText(left?.name).toLowerCase();
  const rightName = readText(right?.name).toLowerCase();
  if (leftName !== rightName) {
    return leftName.localeCompare(rightName, "pt-BR");
  }

  return readText(left?.id).localeCompare(readText(right?.id), "pt-BR");
}

function sortLauncherGamesBySortOrder(games = []) {
  return [...games].sort(compareLauncherGamesBySortOrder);
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

function assertSupabaseConfig() {
  if (!config.supabaseUrl || !config.supabaseRestKey) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: config.supabaseRestKey,
    Authorization: `Bearer ${config.supabaseRestKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = SUPABASE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchSupabaseWithRetry(url, options = {}, retryCount = SUPABASE_FETCH_RETRIES) {
  let lastError = null;
  const maxAttempts = Math.max(1, Number(retryCount) + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, SUPABASE_FETCH_TIMEOUT_MS);
      if (response.status >= 500 && attempt < maxAttempts - 1) {
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" && attempt >= maxAttempts - 1) {
        throw new Error(
          `Supabase demorou para responder (timeout de ${Math.floor(SUPABASE_FETCH_TIMEOUT_MS / 1000)}s).`
        );
      }
      if (attempt >= maxAttempts - 1) {
        throw error;
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error("Falha inesperada ao consultar Supabase.");
}

async function fetchLauncherGamesFromSupabase({ search = "", limit = 250 } = {}) {
  assertSupabaseConfig();

  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_games`);
  endpoint.searchParams.set("select", LAUNCHER_GAMES_SELECT_COLUMNS);
  endpoint.searchParams.set("order", "sort_order.asc.nullslast,updated_at.desc");
  endpoint.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || 1, 1), 500)));

  const normalizedSearch = String(search || "")
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (normalizedSearch) {
    endpoint.searchParams.set("or", `(id.ilike.*${normalizedSearch}*,name.ilike.*${normalizedSearch}*)`);
  }

  const response = await fetchSupabaseWithRetry(endpoint.toString(), {
    method: "GET",
    headers: supabaseHeaders({ Accept: "application/json" })
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);
  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status, "Falha ao listar jogos"));
  }

  const rows = Array.isArray(responsePayload) ? responsePayload : [];
  const games = sortLauncherGamesBySortOrder(rows.map(normalizeLauncherGameRow).filter(Boolean));
  launcherGamesCache.data = games;
  launcherGamesCache.updatedAt = Date.now();
  return games;
}

function getLauncherGamesCacheSnapshot() {
  return {
    data: Array.isArray(launcherGamesCache.data) ? launcherGamesCache.data : [],
    updatedAt: Number(launcherGamesCache.updatedAt || 0)
  };
}

async function deleteLauncherGameInSupabase(gameId) {
  const normalizedId = slugify(gameId);
  if (!normalizedId) {
    throw new Error("ID de jogo invalido.");
  }
  assertSupabaseConfig();

  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_games`);
  endpoint.searchParams.set("id", `eq.${normalizedId}`);
  endpoint.searchParams.set("select", "id");

  const response = await fetchSupabaseWithRetry(endpoint.toString(), {
    method: "DELETE",
    headers: supabaseHeaders({
      Prefer: "return=representation"
    })
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

async function updateLauncherGamesSortOrderInSupabase(updates = []) {
  assertSupabaseConfig();

  const dedupedById = new Map();
  for (const entry of Array.isArray(updates) ? updates : []) {
    const normalizedId = slugify(entry?.id);
    if (!normalizedId) {
      continue;
    }
    const sortOrder = Math.max(1, parseIntegerInput(entry?.sort_order ?? entry?.sortOrder, 1));
    dedupedById.set(normalizedId, {
      id: normalizedId,
      sort_order: sortOrder
    });
  }

  const normalizedUpdates = [...dedupedById.values()];
  if (normalizedUpdates.length === 0) {
    return fetchLauncherGamesFromSupabase({ limit: 500 });
  }

  const batchSize = 12;
  for (let index = 0; index < normalizedUpdates.length; index += batchSize) {
    const batch = normalizedUpdates.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (entry) => {
        const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_games`);
        endpoint.searchParams.set("id", `eq.${entry.id}`);
        endpoint.searchParams.set("select", "id,sort_order");

        const response = await fetchSupabaseWithRetry(endpoint.toString(), {
          method: "PATCH",
          headers: supabaseHeaders({
            Prefer: "return=representation"
          }),
          body: JSON.stringify({
            sort_order: entry.sort_order
          })
        });

        const responseText = await response.text();
        const responsePayload = parseSupabaseResponsePayload(responseText);
        if (!response.ok) {
          throw new Error(
            buildSupabaseErrorMessage(responsePayload, response.status, `Falha ao atualizar ordem de ${entry.id}`)
          );
        }

        const rows = Array.isArray(responsePayload)
          ? responsePayload
          : responsePayload && typeof responsePayload === "object"
            ? [responsePayload]
            : [];
        if (rows.length === 0) {
          throw new Error(`Jogo ${entry.id} nao encontrado para atualizar ordem.`);
        }
      })
    );
  }

  return fetchLauncherGamesFromSupabase({ limit: 500 });
}

async function fetchRuntimeFlagFromSupabase(flagId) {
  const normalizedId = readText(flagId);
  if (!normalizedId) {
    return null;
  }
  assertSupabaseConfig();

  const endpoint = new URL(`${config.supabaseUrl}/rest/v1/launcher_runtime_flags`);
  endpoint.searchParams.set("select", RUNTIME_FLAGS_SELECT_COLUMNS);
  endpoint.searchParams.set("id", `eq.${normalizedId}`);
  endpoint.searchParams.set("limit", "1");

  const response = await fetchSupabaseWithRetry(endpoint.toString(), {
    method: "GET",
    headers: supabaseHeaders({ Accept: "application/json" })
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
  assertSupabaseConfig();

  const response = await fetchSupabaseWithRetry(`${config.supabaseUrl}/rest/v1/launcher_runtime_flags?on_conflict=id`, {
    method: "POST",
    headers: supabaseHeaders({
      Prefer: "resolution=merge-duplicates,return=representation"
    }),
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

async function supabaseHealthCheck() {
  const output = {
    supabaseUrlConfigured: Boolean(config.supabaseUrl),
    supabaseRestKeyConfigured: Boolean(config.supabaseRestKey),
    remoteReachable: false
  };
  if (!config.supabaseUrl || !config.supabaseRestKey) {
    return {
      ...output,
      ok: false,
      message: "Variaveis de ambiente do Supabase ausentes/incompletas."
    };
  }

  try {
    const endpoint = new URL(`${config.supabaseUrl}/rest/v1/admin_steam_ids`);
    endpoint.searchParams.set("select", "steam_id");
    endpoint.searchParams.set("limit", "1");
    const response = await fetchSupabaseWithRetry(
      endpoint.toString(),
      {
        method: "GET",
        headers: supabaseHeaders({ Accept: "application/json" })
      },
      0
    );
    const raw = await response.text();
    const parsed = parseSupabaseResponsePayload(raw);
    if (!response.ok) {
      return {
        ...output,
        ok: false,
        remoteReachable: false,
        message: buildSupabaseErrorMessage(parsed, response.status, "Falha ao consultar Supabase")
      };
    }
    return {
      ...output,
      ok: true,
      remoteReachable: true
    };
  } catch (error) {
    return {
      ...output,
      ok: false,
      remoteReachable: false,
      message: readText(error?.message, "Falha de conectividade com Supabase.")
    };
  }
}

module.exports = {
  MAINTENANCE_FLAG_ID,
  defaultMaintenanceFlag,
  parseBooleanInput,
  parseObjectInput,
  parsePositiveIntegerInput,
  readText,
  fetchLauncherGamesFromSupabase,
  getLauncherGamesCacheSnapshot,
  deleteLauncherGameInSupabase,
  updateLauncherGamesSortOrderInSupabase,
  fetchRuntimeFlagFromSupabase,
  upsertRuntimeFlagInSupabase,
  supabaseHealthCheck
};
