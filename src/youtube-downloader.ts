// @ts-nocheck
const ytdl = require("@distube/ytdl-core");

const YOUTUBE_INFO_TIMEOUT_MS = 15000;
const YOUTUBE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;

const youtubeInfoCache = new Map();

const YTDL_CLIENT_ATTEMPTS = [
  { label: "default", options: {} },
  { label: "tv_ios_android", options: { playerClients: ["TV", "IOS", "ANDROID"] } },
  { label: "web_embedded_ios_android_tv", options: { playerClients: ["WEB_EMBEDDED", "IOS", "ANDROID", "TV"] } },
  { label: "web_only", options: { playerClients: ["WEB"] } }
];

let ytdlAgent = null;
let ytdlAgentInitialized = false;

function readText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isSupportedYouTubeHost(hostname) {
  const host = readText(hostname).toLowerCase();
  return [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be"
  ].includes(host);
}

function normalizeYoutubeUrl(value) {
  const raw = readText(value);
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (!isSupportedYouTubeHost(parsed.hostname)) {
      return "";
    }
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function extractVideoIdFromYoutubeUrl(value) {
  const normalizedUrl = normalizeYoutubeUrl(value);
  if (!normalizedUrl) return "";
  try {
    return readText(ytdl.getURLVideoID(normalizedUrl));
  } catch (_error) {
    return "";
  }
}

function parseInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Number(fallback) || 0;
  }
  return Math.trunc(parsed);
}

function formatBytesLabel(bytesRaw) {
  const bytes = Number(bytesRaw);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = amount >= 100 || unitIndex === 0 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDurationLabel(lengthSecondsRaw) {
  const totalSeconds = parseInteger(lengthSecondsRaw, 0);
  if (totalSeconds <= 0) {
    return "";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function sanitizeFileName(value, fallback = "youtube-video") {
  const raw = readText(value, fallback);
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.slice(0, 120);
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function parseYoutubeCookiesFromEnv() {
  const raw =
    readText(process.env.YOUTUBE_COOKIES_JSON) ||
    readText(process.env.YTDL_COOKIES_JSON) ||
    readText(process.env.YOUTUBE_COOKIES);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function getYtdlAgent() {
  if (ytdlAgentInitialized) {
    return ytdlAgent;
  }
  ytdlAgentInitialized = true;

  try {
    const cookies = parseYoutubeCookiesFromEnv();
    if (cookies.length > 0) {
      ytdlAgent = ytdl.createAgent(cookies);
    }
  } catch (_error) {
    ytdlAgent = null;
  }

  return ytdlAgent;
}

function buildYtdlInfoOptions(extraOptions = {}) {
  const agent = getYtdlAgent();
  if (!agent) {
    return { ...extraOptions };
  }
  return {
    ...extraOptions,
    agent
  };
}

function isRetryableYoutubeError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if ([403, 408, 410, 429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const message = readText(error?.message).toLowerCase();
  return (
    message.includes("status code: 410") ||
    message.includes("status code: 429") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("extract functions") ||
    message.includes("decipher") ||
    message.includes("429")
  );
}

function clearYtdlCaches() {
  try {
    ytdl?.cache?.info?.clear?.();
  } catch (_error) {
    // noop
  }
  try {
    ytdl?.cache?.watch?.clear?.();
  } catch (_error) {
    // noop
  }
}

function toFriendlyYoutubeErrorMessage(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const rawMessage = readText(error?.message || "Falha ao consultar YouTube.");
  const lower = rawMessage.toLowerCase();

  if (statusCode === 410 || lower.includes("status code: 410")) {
    return "YouTube retornou 410 para este video. O servidor tentou fallback automaticamente, mas nao conseguiu liberar os formatos agora.";
  }
  if (statusCode === 429 || lower.includes("status code: 429")) {
    return "YouTube limitou as requisicoes (429). Aguarde alguns minutos e tente novamente.";
  }
  if (rawMessage.includes("Could not extract functions")) {
    return "O parser de formatos do YouTube falhou ao extrair funcoes de assinatura.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Tempo excedido ao consultar YouTube.";
  }
  return rawMessage;
}

function extractFormatHeight(format) {
  const direct = parseInteger(format?.height, 0);
  if (direct > 0) {
    return direct;
  }
  const qualityLabel = readText(format?.qualityLabel);
  const matched = qualityLabel.match(/(\d{3,4})p/i);
  if (matched?.[1]) {
    return parseInteger(matched[1], 0);
  }
  return 0;
}

function estimateContentBytes(format, durationSeconds) {
  const direct = parseInteger(format?.contentLength, 0);
  if (direct > 0) {
    return direct;
  }
  const bitrate = parseInteger(format?.bitrate, 0);
  if (bitrate > 0 && durationSeconds > 0) {
    return Math.floor((bitrate / 8) * durationSeconds);
  }
  return 0;
}

function mapMp4QualityOptions(info) {
  const durationSeconds = parseInteger(info?.videoDetails?.lengthSeconds, 0);
  const formats = Array.isArray(info?.formats) ? info.formats : [];

  const candidates = formats.filter((format) => {
    if (!format) return false;
    if (!format.hasVideo) return false;
    if (String(format.container || "").toLowerCase() !== "mp4") return false;
    return true;
  });

  const byVariant = new Map();
  for (const format of candidates) {
    const itag = parseInteger(format.itag, 0);
    if (!itag) continue;
    const qualityLabel = readText(format.qualityLabel, format.quality || "Qualidade desconhecida");
    const fps = parseInteger(format.fps, 0);
    const hasAudio = Boolean(format.hasAudio);
    const height = extractFormatHeight(format);
    const estimatedBytes = estimateContentBytes(format, durationSeconds);
    const key = `${qualityLabel}|${fps}|${hasAudio ? "a" : "na"}`;
    const current = byVariant.get(key);
    const nextEntry = {
      itag,
      qualityLabel,
      fps,
      container: "mp4",
      hasAudio,
      hasVideo: Boolean(format.hasVideo),
      bitrate: parseInteger(format.bitrate, 0),
      height,
      estimatedBytes,
      estimatedSizeLabel: formatBytesLabel(estimatedBytes)
    };
    if (!current) {
      byVariant.set(key, nextEntry);
      continue;
    }
    const shouldReplace =
      nextEntry.height > current.height ||
      nextEntry.bitrate > current.bitrate ||
      nextEntry.estimatedBytes > current.estimatedBytes;
    if (shouldReplace) {
      byVariant.set(key, nextEntry);
    }
  }

  return Array.from(byVariant.values()).sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    if (b.hasAudio !== a.hasAudio) return Number(b.hasAudio) - Number(a.hasAudio);
    if (b.fps !== a.fps) return b.fps - a.fps;
    return b.bitrate - a.bitrate;
  });
}

async function getYoutubeInfo(normalizedUrl) {
  const videoId = readText(ytdl.getURLVideoID(normalizedUrl));
  if (!videoId) {
    throw new Error("URL do YouTube invalida.");
  }

  const cacheEntry = youtubeInfoCache.get(videoId);
  if (cacheEntry && Number(cacheEntry.expiresAt || 0) > Date.now() && cacheEntry.info) {
    return cacheEntry.info;
  }

  const canonicalUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const triedUrls = [normalizedUrl];
  if (canonicalUrl !== normalizedUrl) {
    triedUrls.push(canonicalUrl);
  }

  let lastError = null;

  for (const targetUrl of triedUrls) {
    for (const attempt of YTDL_CLIENT_ATTEMPTS) {
      try {
        const info = await withTimeout(
          ytdl.getInfo(targetUrl, buildYtdlInfoOptions(attempt.options)),
          YOUTUBE_INFO_TIMEOUT_MS,
          "Tempo excedido ao consultar YouTube."
        );
        youtubeInfoCache.set(videoId, {
          info,
          expiresAt: Date.now() + YOUTUBE_INFO_CACHE_TTL_MS
        });
        return info;
      } catch (error) {
        lastError = error;
        if (!isRetryableYoutubeError(error)) {
          throw new Error(toFriendlyYoutubeErrorMessage(error));
        }
        clearYtdlCaches();
      }
    }
  }

  throw new Error(toFriendlyYoutubeErrorMessage(lastError));
}

async function getYoutubeFormatsForUrl(urlRaw) {
  const normalizedUrl = normalizeYoutubeUrl(urlRaw);
  if (!normalizedUrl) {
    throw new Error("Cole um link valido do YouTube.");
  }
  if (!ytdl.validateURL(normalizedUrl)) {
    throw new Error("URL do YouTube nao reconhecida.");
  }

  const info = await getYoutubeInfo(normalizedUrl);
  const videoId = readText(info?.videoDetails?.videoId || extractVideoIdFromYoutubeUrl(normalizedUrl));
  const title = readText(info?.videoDetails?.title, "Video do YouTube");
  const durationSeconds = parseInteger(info?.videoDetails?.lengthSeconds, 0);
  const durationLabel = formatDurationLabel(durationSeconds);
  const thumbnails = Array.isArray(info?.videoDetails?.thumbnails) ? info.videoDetails.thumbnails : [];
  const thumbnailUrl = readText(thumbnails[thumbnails.length - 1]?.url);

  const formats = mapMp4QualityOptions(info);
  if (!formats.length) {
    throw new Error("Nao encontramos formatos MP4 para esse video.");
  }

  return {
    videoId,
    normalizedUrl,
    title,
    durationSeconds,
    durationLabel,
    thumbnailUrl,
    formats
  };
}

async function resolveDownloadTarget(urlRaw, itagRaw) {
  const normalizedUrl = normalizeYoutubeUrl(urlRaw);
  if (!normalizedUrl) {
    throw new Error("Cole um link valido do YouTube.");
  }
  if (!ytdl.validateURL(normalizedUrl)) {
    throw new Error("URL do YouTube nao reconhecida.");
  }

  const selectedItag = parseInteger(itagRaw, 0);
  if (!selectedItag) {
    throw new Error("Selecione uma qualidade valida.");
  }

  const info = await getYoutubeInfo(normalizedUrl);
  const format = (Array.isArray(info?.formats) ? info.formats : []).find((entry) => {
    return parseInteger(entry?.itag, 0) === selectedItag && String(entry?.container || "").toLowerCase() === "mp4" && entry?.hasVideo;
  });

  if (!format) {
    throw new Error("Formato selecionado nao encontrado. Atualize a lista de qualidades.");
  }
  if (!readText(format?.url)) {
    throw new Error("Formato selecionado esta temporariamente indisponivel no YouTube. Escolha outra qualidade.");
  }

  const title = readText(info?.videoDetails?.title, "youtube-video");
  const qualityLabel = readText(format?.qualityLabel, `itag-${selectedItag}`);
  const safeFileName = sanitizeFileName(`${title} ${qualityLabel}`.replace(/\s+/g, " ").trim(), "youtube-video");
  const outputFileName = `${safeFileName}.mp4`;

  return {
    info,
    format,
    outputFileName,
    selectedItag
  };
}

module.exports = {
  getYoutubeFormatsForUrl,
  resolveDownloadTarget
};
