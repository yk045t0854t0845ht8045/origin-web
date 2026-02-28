// @ts-nocheck
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { requireAdmin } = require("../../src/route-auth");
const runtimeConfig = require("../../src/config");
const { createDriveService } = require("../../src/drive");
const { slugify } = require("../../src/utils");

const SUPABASE_FETCH_TIMEOUT_MS = 8000;
const SUPABASE_FETCH_RETRIES = 0;

const driveService = createDriveService(runtimeConfig);
fs.mkdirSync(runtimeConfig.uploadTempDir, { recursive: true });

const publishUpload = multer({
  dest: runtimeConfig.uploadTempDir,
  limits: {
    fileSize: runtimeConfig.maxUploadBytes
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(String(file?.originalname || "")).toLowerCase();
    if (extension !== ".rar" && extension !== ".zip") {
      callback(new Error("Somente arquivos .rar ou .zip sao aceitos."));
      return;
    }
    callback(null, true);
  }
});

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

function runMiddleware(req, res, middleware) {
  return new Promise((resolve, reject) => {
    middleware(req, res, (result) => {
      if (result instanceof Error) {
        reject(result);
        return;
      }
      resolve(result);
    });
  });
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

function normalizeArchiveType(value) {
  return String(value || "rar")
    .trim()
    .toLowerCase() === "zip"
    ? "zip"
    : "rar";
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
    // Ignore parse error and fallback to split text.
  }
  return raw
    .split(/[,\n;\r]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
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

function parseHttpUrlInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

function isGoogleDriveFolderLink(value) {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) {
    return false;
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("drive.google.com")) {
    return false;
  }
  return /\/folders\/[a-zA-Z0-9_-]+/i.test(parsed.pathname);
}

function isDropboxLink(value) {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) {
    return false;
  }
  const host = String(parsed.hostname || "").toLowerCase();
  return host.includes("dropbox.com") || host.includes("dropboxusercontent.com");
}

function isDropboxFolderLink(value) {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) {
    return false;
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("dropbox.com") && !host.includes("dropboxusercontent.com")) {
    return false;
  }
  const pathName = String(parsed.pathname || "").toLowerCase();
  return (
    pathName.startsWith("/home") ||
    pathName.includes("/scl/fo/") ||
    pathName.includes("/sh/") ||
    pathName.includes("/folder/")
  );
}

function extractGoogleDriveFileId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  if (/^[a-zA-Z0-9_-]{16,}$/.test(raw) && !raw.includes("/")) {
    return raw;
  }
  const parsed = parseHttpUrlInput(raw);
  if (!parsed) {
    return "";
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("drive.google.com") && !host.includes("drive.usercontent.google.com")) {
    return "";
  }
  const byPath = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i)?.[1];
  if (byPath) {
    return byPath;
  }
  const byQuery = String(parsed.searchParams.get("id") || parsed.searchParams.get("fileId") || "").trim();
  if (byQuery && /^[a-zA-Z0-9_-]{16,}$/.test(byQuery)) {
    return byQuery;
  }
  return "";
}

function createDropboxDirectDownloadUrl(value) {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) {
    return "";
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("dropbox.com") && !host.includes("dropboxusercontent.com")) {
    return "";
  }
  if (host.includes("dropbox.com") && !host.includes("dropboxusercontent.com")) {
    parsed.searchParams.delete("raw");
    parsed.searchParams.set("dl", "1");
  }
  return parsed.toString();
}

function normalizeRemoteDownloadUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  if (isDropboxLink(raw)) {
    return createDropboxDirectDownloadUrl(raw);
  }
  const parsed = parseHttpUrlInput(raw);
  return parsed ? parsed.toString() : "";
}

function detectDownloadSourceKind(value) {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) {
    return "http";
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (
    host.includes("drive.google.com") ||
    host.includes("drive.usercontent.google.com") ||
    host.includes("drive.googleusercontent.com") ||
    host.includes("googleapis.com")
  ) {
    return "google-drive";
  }
  if (host.includes("dropbox.com") || host.includes("dropboxusercontent.com")) {
    return "dropbox";
  }
  return "http";
}

function buildDownloadSourcePriority(kind, index = 0) {
  const safeIndex = Math.max(0, Number(index) || 0);
  if (kind === "google-drive") {
    return 91 + safeIndex * 0.1;
  }
  if (kind === "dropbox") {
    return 32 + safeIndex * 0.1;
  }
  return 40 + safeIndex * 0.1;
}

function createDriveDownloadUrl(fileId, withConfirm = false) {
  const encodedId = encodeURIComponent(String(fileId || "").trim());
  const base = `https://drive.usercontent.google.com/download?id=${encodedId}&export=download&authuser=0`;
  return withConfirm ? `${base}&confirm=t` : base;
}

function createDriveDirectDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(String(fileId || "").trim())}`;
}

function buildGoogleApiDownloadUrl(fileId, apiKey) {
  const cleanId = String(fileId || "").trim();
  const cleanApiKey = String(apiKey || "").trim();
  if (!cleanId || !cleanApiKey) {
    return "";
  }
  const params = new URLSearchParams({
    alt: "media",
    supportsAllDrives: "true",
    acknowledgeAbuse: "true",
    key: cleanApiKey
  });
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?${params.toString()}`;
}

function createDownloadSources(gameId, fileId, googleApiKey = "", downloadUrls = []) {
  const cleanGameId = String(gameId || "").trim();
  const cleanFileId = String(fileId || "").trim();
  const sources = [];
  const seenUrls = new Set();

  const pushSource = (url, label, kind, priority) => {
    const normalized = normalizeRemoteDownloadUrl(url);
    if (!normalized || seenUrls.has(normalized)) {
      return;
    }
    seenUrls.add(normalized);
    sources.push({
      url: normalized,
      label: String(label || "").trim(),
      kind: String(kind || "").trim() || "http",
      priority: Number(priority) || 0
    });
  };

  if (cleanFileId) {
    pushSource(createDriveDownloadUrl(cleanFileId, false), `driveusercontent-${cleanGameId || "source"}`, "google-drive", 88);
    pushSource(createDriveDownloadUrl(cleanFileId, true), "driveusercontent-confirm", "google-drive", 89);
    pushSource(
      `https://drive.googleusercontent.com/uc?id=${encodeURIComponent(cleanFileId)}&export=download`,
      "drive-googleusercontent",
      "google-drive",
      87
    );
    pushSource(
      `https://docs.google.com/uc?export=download&id=${encodeURIComponent(cleanFileId)}`,
      "drive-docs-uc",
      "google-drive",
      87.5
    );
    pushSource(
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cleanFileId)}`,
      "drive-uc-fallback",
      "google-drive",
      92
    );
    pushSource(
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cleanFileId)}&confirm=t`,
      "drive-uc-fallback-confirm",
      "google-drive",
      92.2
    );

    const apiUrl = buildGoogleApiDownloadUrl(cleanFileId, googleApiKey);
    if (apiUrl) {
      pushSource(apiUrl, "google-drive-api", "google-drive", 85.5);
    }
  }

  const normalizedUrls = Array.isArray(downloadUrls)
    ? downloadUrls
        .map((entry) => normalizeRemoteDownloadUrl(entry))
        .filter(Boolean)
    : [];
  normalizedUrls.forEach((url, index) => {
    const kind = detectDownloadSourceKind(url);
    const labelPrefix = kind === "google-drive" ? "google-drive" : kind === "dropbox" ? "dropbox" : "mirror";
    pushSource(url, `${labelPrefix}-${cleanGameId || "source"}-${index + 1}`, kind, buildDownloadSourcePriority(kind, index));
  });

  return sources.sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
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
      const response = await fetchWithTimeout(url, options);
      if (response.status >= 500 && attempt < maxAttempts - 1) {
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" && attempt >= maxAttempts - 1) {
        throw new Error("Supabase demorou para responder na publicacao do jogo.");
      }
      if (attempt >= maxAttempts - 1) {
        throw error;
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error("Falha inesperada ao consultar Supabase.");
}

function assertSupabaseConfig() {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseRestKey) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: runtimeConfig.supabaseRestKey,
    Authorization: `Bearer ${runtimeConfig.supabaseRestKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function fetchLauncherGameByIdFromSupabase(gameId) {
  assertSupabaseConfig();
  const normalizedId = slugify(gameId);
  if (!normalizedId) {
    return null;
  }
  const endpoint = new URL(`${runtimeConfig.supabaseUrl}/rest/v1/launcher_games`);
  endpoint.searchParams.set("select", LAUNCHER_GAMES_SELECT_COLUMNS);
  endpoint.searchParams.set("id", `eq.${normalizedId}`);
  endpoint.searchParams.set("limit", "1");

  const response = await fetchSupabaseWithRetry(endpoint.toString(), {
    method: "GET",
    headers: supabaseHeaders()
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
  assertSupabaseConfig();
  const response = await fetchSupabaseWithRetry(`${runtimeConfig.supabaseUrl}/rest/v1/launcher_games?on_conflict=id`, {
    method: "POST",
    headers: supabaseHeaders({
      Prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify(gamePayload)
  });

  const responseText = await response.text();
  const responsePayload = parseSupabaseResponsePayload(responseText);
  if (!response.ok) {
    throw new Error(buildSupabaseErrorMessage(responsePayload, response.status, "Falha ao salvar jogo no Supabase"));
  }

  if (Array.isArray(responsePayload)) {
    return responsePayload[0] || gamePayload;
  }
  return responsePayload || gamePayload;
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  const viewer = await requireAdmin(req, res, {
    permission: "publishGame",
    permissionMessage: "Seu cargo nao pode publicar jogos."
  });
  if (!viewer) {
    return;
  }

  try {
    await runMiddleware(req, res, publishUpload.single("archive"));
  } catch (error) {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "archive_too_large",
        message: `Arquivo maior que o limite configurado (${runtimeConfig.uploadMaxMb} MB).`
      });
      return;
    }
    const message = String(error?.message || "Falha no upload do arquivo.");
    res.status(400).json({
      error: "invalid_archive_upload",
      message
    });
    return;
  }

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
    const canEditGames = Boolean(viewer?.permissions?.editGame);
    if (existingGame && !canEditGames) {
      res.status(403).json({
        error: "forbidden_permission",
        message: "Seu cargo pode criar jogos, mas nao pode editar jogos existentes."
      });
      return;
    }

    const archiveTypeFromFile = path.extname(String(req.file?.originalname || "")).toLowerCase() === ".zip" ? "zip" : "rar";
    const archiveType = normalizeArchiveType(
      req.body?.archiveType || req.body?.archive_type || existingGame?.archive_type || archiveTypeFromFile
    );

    let uploadResult = null;
    const driveLinkInput = readText(req.body?.driveLink || req.body?.drive_link);
    const hasGoogleDriveFolderLinkInput = isGoogleDriveFolderLink(driveLinkInput);
    const hasDropboxFolderLinkInput = isDropboxFolderLink(driveLinkInput);
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
    const downloadUrlsInputRaw = parseArrayInput(req.body?.downloadUrls || req.body?.download_urls);
    const downloadUrlsInput = Array.from(
      new Set(
        downloadUrlsInputRaw
          .map((entry) => normalizeRemoteDownloadUrl(entry))
          .filter(Boolean)
      )
    );
    if (!driveFileId && downloadUrlsInput.length > 0) {
      for (const candidate of downloadUrlsInput) {
        const extractedId = readText(extractGoogleDriveFileId(candidate));
        if (extractedId) {
          driveFileId = extractedId;
          break;
        }
      }
    }
    const directDownloadUrl = driveFileId ? createDriveDirectDownloadUrl(driveFileId) : "";
    const normalizedDriveLinkInput = normalizeRemoteDownloadUrl(driveLinkInput);
    const gallery = galleryInput.length ? galleryInput : normalizeJsonArrayField(existingGame?.gallery);
    const genres = genresInput.length ? genresInput : normalizeJsonArrayField(existingGame?.genres);
    const downloadUrls = downloadUrlsInput.length
      ? downloadUrlsInput
      : directDownloadUrl
        ? [directDownloadUrl]
        : normalizedDriveLinkInput
          ? [normalizedDriveLinkInput]
          : normalizeJsonArrayField(existingGame?.download_urls);
    if (!driveFileId && downloadUrls.length === 0) {
      res.status(400).json({
        error: "missing_download_source",
        message: hasGoogleDriveFolderLinkInput
          ? "Link de pasta detectado. Cole um link de arquivo do Google Drive (.rar/.zip), nao de pasta."
          : hasDropboxFolderLinkInput
            ? "Link de pasta detectado. Cole o link direto do arquivo no Dropbox (.rar/.zip), nao de pasta."
            : "Envie um .rar/.zip, informe driveFileId ou adicione ao menos um link de download em downloadUrls."
      });
      return;
    }
    const sizeBytesRaw = readText(req.body?.sizeBytes || req.body?.size_bytes, readText(existingGame?.size_bytes));
    const sizeBytes = sizeBytesRaw || String(parsePositiveIntegerInput(req.file?.size, 0));
    const steamAppId =
      parsePositiveIntegerInput(req.body?.steamAppId || req.body?.steam_app_id, 0) ||
      extractSteamAppId(req.body?.steamUrl || req.body?.steam_url) ||
      parsePositiveIntegerInput(existingGame?.steam_app_id, 0);
    const resolvedGoogleApiKey = readText(
      req.body?.googleApiKey || req.body?.google_api_key,
      readText(runtimeConfig.googleApiKey)
    );

    const gamePayload = {
      id,
      name,
      section: readText(req.body?.section, readText(existingGame?.section, "Catalogo")),
      description: readText(req.body?.description, readText(existingGame?.description)),
      long_description: readText(req.body?.longDescription || req.body?.long_description, readText(existingGame?.long_description)),
      archive_type: archiveType,
      archive_password: readText(
        req.body?.archivePassword || req.body?.archive_password,
        readText(existingGame?.archive_password, "online-fix.me")
      ),
      checksum_sha256: readText(req.body?.checksumSha256 || req.body?.checksum_sha256, readText(existingGame?.checksum_sha256)),
      download_url: readText(
        downloadUrls[0],
        driveFileId ? createDriveDownloadUrl(driveFileId, false) : readText(existingGame?.download_url)
      ),
      download_urls: downloadUrls,
      download_sources: createDownloadSources(id, driveFileId, resolvedGoogleApiKey, downloadUrls),
      local_archive_file: readText(req.body?.localArchiveFile || req.body?.local_archive_file, readText(existingGame?.local_archive_file)),
      install_dir_name: readText(req.body?.installDirName || req.body?.install_dir_name, readText(existingGame?.install_dir_name, name)),
      launch_executable: readText(req.body?.launchExecutable || req.body?.launch_executable, readText(existingGame?.launch_executable)),
      auto_detect_executable: parseBooleanInput(
        req.body?.autoDetectExecutable || req.body?.auto_detect_executable,
        parseBooleanInput(existingGame?.auto_detect_executable, true)
      ),
      image_url: readText(req.body?.imageUrl || req.body?.image_url, readText(existingGame?.image_url)),
      card_image_url: readText(req.body?.cardImageUrl || req.body?.card_image_url, readText(existingGame?.card_image_url)),
      banner_url: readText(req.body?.bannerUrl || req.body?.banner_url, readText(existingGame?.banner_url)),
      logo_url: readText(req.body?.logoUrl || req.body?.logo_url, readText(existingGame?.logo_url)),
      trailer_url: readText(req.body?.trailerUrl || req.body?.trailer_url, readText(existingGame?.trailer_url)),
      developed_by: readText(req.body?.developedBy || req.body?.developed_by, readText(existingGame?.developed_by)),
      published_by: readText(req.body?.publishedBy || req.body?.published_by, readText(existingGame?.published_by, "WPlay Games - OnlineFix")),
      release_date: readText(req.body?.releaseDate || req.body?.release_date, readText(existingGame?.release_date)),
      steam_app_id: steamAppId,
      gallery,
      genres,
      average_play_time: readText(req.body?.averagePlayTime || req.body?.average_play_time, readText(existingGame?.average_play_time)),
      average_achievement: readText(req.body?.averageAchievement || req.body?.average_achievement, readText(existingGame?.average_achievement)),
      size_bytes: sizeBytes,
      size_label: readText(req.body?.sizeLabel || req.body?.size_label, readText(existingGame?.size_label)),
      store_type: readText(req.body?.storeType || req.body?.store_type, readText(existingGame?.store_type)),
      store_tag: readText(req.body?.storeTag || req.body?.store_tag, readText(existingGame?.store_tag)),
      current_price: readText(req.body?.currentPrice || req.body?.current_price, readText(existingGame?.current_price, "Gratuito")),
      original_price: readText(req.body?.originalPrice || req.body?.original_price, readText(existingGame?.original_price)),
      discount_percent: readText(req.body?.discountPercent || req.body?.discount_percent, readText(existingGame?.discount_percent, "0%")),
      free: parseBooleanInput(req.body?.free, parseBooleanInput(existingGame?.free, false)),
      exclusive: parseBooleanInput(req.body?.exclusive, parseBooleanInput(existingGame?.exclusive, false)),
      coming_soon: parseBooleanInput(req.body?.comingSoon || req.body?.coming_soon, parseBooleanInput(existingGame?.coming_soon, false)),
      enabled: parseBooleanInput(req.body?.enabled, parseBooleanInput(existingGame?.enabled, true)),
      sort_order: parseIntegerInput(req.body?.sortOrder || req.body?.sort_order, parseIntegerInput(existingGame?.sort_order, 100))
    };

    const savedGame = await upsertLauncherGameInSupabase(gamePayload);

    res.status(200).json({
      ok: true,
      action: uploadResult ? "upload_and_save" : existingGame ? "update_metadata" : "create_metadata",
      savedAt: new Date().toISOString(),
      game: savedGame,
      upload: uploadResult
    });
  } catch (error) {
    const message = String(error?.message || "Falha ao publicar jogo.");
    const status =
      message.toLowerCase().includes("inval") ||
      message.toLowerCase().includes("preencha") ||
      message.toLowerCase().includes("link de pasta") ||
      message.toLowerCase().includes("drive")
        ? 400
        : message.toLowerCase().includes("nao pode editar")
          ? 403
          : 502;

    res.status(status).json({
      error: "publish_failed",
      message
    });
  } finally {
    if (tempFilePath) {
      fs.unlink(tempFilePath, () => {});
    }
  }
}
