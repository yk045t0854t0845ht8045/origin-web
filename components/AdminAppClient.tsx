"use client";

import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";

type ViewerState = {
  authenticated: boolean;
  isAdmin: boolean;
  role?: "developer" | "administrador" | "staff" | "";
  permissions?: {
    manageStaff: boolean;
    publishGame: boolean;
    editGame: boolean;
    removeGame: boolean;
    manageMaintenance: boolean;
  };
  steamLoginReady: boolean;
  steamLoginReason?: string;
  adminError?: string;
  adminStorage?: string;
  user: {
    steamId: string;
    displayName: string;
    avatar: string;
  } | null;
};

type AdminRecord = {
  steamId: string;
  staffName: string;
  staffRole: string;
  createdAt: string;
  steamProfile?: {
    steamId: string;
    displayName: string;
    avatar: string;
    avatarUrl?: string;
    profileUrl: string;
  };
};

type MaintenanceFlag = {
  id: string;
  enabled: boolean;
  title: string;
  message: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type LauncherGame = {
  id: string;
  name: string;
  section: string;
  description: string;
  long_description: string;
  archive_type: "rar" | "zip";
  archive_password: string;
  install_dir_name: string;
  launch_executable: string;
  image_url: string;
  card_image_url: string;
  banner_url: string;
  logo_url: string;
  trailer_url: string;
  developed_by: string;
  published_by: string;
  release_date: string;
  steam_app_id: number;
  genres: string[];
  gallery: string[];
  download_urls: string[];
  size_bytes: string;
  size_label: string;
  current_price: string;
  original_price: string;
  discount_percent: string;
  free: boolean;
  exclusive: boolean;
  coming_soon: boolean;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  google_drive_file_id?: string;
  download_url: string;
  updated_at: string;
  imageUrl?: string;
  cardImageUrl?: string;
  bannerUrl?: string;
  logoUrl?: string;
};

type FormState = {
  id: string;
  name: string;
  section: string;
  description: string;
  longDescription: string;
  archiveType: "rar" | "zip";
  archivePassword: string;
  installDirName: string;
  launchExecutable: string;
  imageUrl: string;
  cardImageUrl: string;
  bannerUrl: string;
  logoUrl: string;
  trailerUrl: string;
  developedBy: string;
  publishedBy: string;
  releaseDate: string;
  steamAppId: string;
  steamUrl: string;
  genres: string;
  gallery: string;
  downloadUrls: string;
  sizeBytes: string;
  sizeLabel: string;
  currentPrice: string;
  originalPrice: string;
  discountPercent: string;
  sortOrder: string;
  free: boolean;
  exclusive: boolean;
  comingSoon: boolean;
  enabled: boolean;
};

type EditorDraft = {
  form: FormState;
  genreInput: string;
  galleryInput: string;
  linkedDriveFileId?: string;
  linkedDriveUrl?: string;
  updatedAt: string;
};

type JsonObject = Record<string, unknown>;

const EMPTY_VIEWER: ViewerState = {
  authenticated: false,
  isAdmin: false,
  role: "",
  permissions: {
    manageStaff: false,
    publishGame: false,
    editGame: false,
    removeGame: false,
    manageMaintenance: false
  },
  steamLoginReady: false,
  steamLoginReason: "",
  user: null
};

const DEFAULT_MAINTENANCE_FLAG: MaintenanceFlag = {
  id: "maintenance_mode",
  enabled: false,
  title: "Manutencao programada",
  message: "Pode haver instabilidades temporarias durante este periodo.",
  data: {},
  createdAt: "",
  updatedAt: ""
};

const INITIAL_FORM: FormState = {
  id: "",
  name: "",
  section: "Catalogo",
  description: "",
  longDescription: "",
  archiveType: "rar",
  archivePassword: "online-fix.me",
  installDirName: "",
  launchExecutable: "",
  imageUrl: "",
  cardImageUrl: "",
  bannerUrl: "",
  logoUrl: "",
  trailerUrl: "",
  developedBy: "",
  publishedBy: "WPlay Games - OnlineFix",
  releaseDate: "",
  steamAppId: "",
  steamUrl: "",
  genres: "",
  gallery: "",
  downloadUrls: "",
  sizeBytes: "",
  sizeLabel: "",
  currentPrice: "Grátis",
  originalPrice: "",
  discountPercent: "0%",
  sortOrder: "100",
  free: false,
  exclusive: false,
  comingSoon: false,
  enabled: true
};

const EDITOR_DRAFT_STORAGE_KEY = "wplay.admin.editor.draft.v1";
const EDITOR_LAYOUT_STORAGE_KEY = "wplay.admin.editor.layout.v1";
const NOTICE_AUTO_HIDE_MS = 4000;

function normalizeId(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toListText(items: string[] = []): string {
  return items.filter(Boolean).join("\n");
}

function parseListText(value: string): string[] {
  return String(value || "")
    .split(/[,\n;\r]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of items) {
    const value = String(entry || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeUrlInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/")) return raw;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return raw;
}

const MONTH_TOKEN_TO_NUMBER: Record<string, number> = {
  jan: 1,
  january: 1,
  janeiro: 1,
  feb: 2,
  february: 2,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  march: 3,
  marco: 3,
  abril: 4,
  apr: 4,
  april: 4,
  abr: 4,
  may: 5,
  maio: 5,
  jun: 6,
  june: 6,
  junho: 6,
  jul: 7,
  july: 7,
  julho: 7,
  aug: 8,
  august: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  set: 9,
  setembro: 9,
  oct: 10,
  october: 10,
  out: 10,
  outubro: 10,
  nov: 11,
  november: 11,
  novembro: 11,
  dec: 12,
  december: 12,
  dez: 12,
  dezembro: 12
};

function normalizeMonthToken(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

function toIsoDateString(year: number, month: number, day: number): string {
  const safeYear = Math.trunc(Number(year));
  const safeMonth = Math.trunc(Number(month));
  const safeDay = Math.trunc(Number(day));
  if (!Number.isFinite(safeYear) || !Number.isFinite(safeMonth) || !Number.isFinite(safeDay)) {
    return "";
  }
  if (safeYear < 1900 || safeYear > 2100 || safeMonth < 1 || safeMonth > 12 || safeDay < 1 || safeDay > 31) {
    return "";
  }
  const date = new Date(Date.UTC(safeYear, safeMonth - 1, safeDay));
  if (
    date.getUTCFullYear() !== safeYear ||
    date.getUTCMonth() + 1 !== safeMonth ||
    date.getUTCDate() !== safeDay
  ) {
    return "";
  }
  const y = String(safeYear).padStart(4, "0");
  const m = String(safeMonth).padStart(2, "0");
  const d = String(safeDay).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeReleaseDateInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const yyyyMmDdMatch = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (yyyyMmDdMatch) {
    return toIsoDateString(Number(yyyyMmDdMatch[1]), Number(yyyyMmDdMatch[2]), Number(yyyyMmDdMatch[3]));
  }

  const ddMmYyyyMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (ddMmYyyyMatch) {
    return toIsoDateString(Number(ddMmYyyyMatch[3]), Number(ddMmYyyyMatch[2]), Number(ddMmYyyyMatch[1]));
  }

  const ddMonthYyyyMatch = raw.match(/^(\d{1,2})\s*(?:de\s+)?([a-zA-Z\u00C0-\u017F.]+)\s*(?:de\s+)?(\d{4})$/i);
  if (ddMonthYyyyMatch) {
    const month = MONTH_TOKEN_TO_NUMBER[normalizeMonthToken(ddMonthYyyyMatch[2])] || 0;
    return toIsoDateString(Number(ddMonthYyyyMatch[3]), month, Number(ddMonthYyyyMatch[1]));
  }

  const monthDdYyyyMatch = raw.match(/^([a-zA-Z\u00C0-\u017F.]+)\s+(\d{1,2})(?:,)?\s+(\d{4})$/i);
  if (monthDdYyyyMatch) {
    const month = MONTH_TOKEN_TO_NUMBER[normalizeMonthToken(monthDdYyyyMatch[1])] || 0;
    return toIsoDateString(Number(monthDdYyyyMatch[3]), month, Number(monthDdYyyyMatch[2]));
  }

  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) {
    return toIsoDateString(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return "";
}

function normalizeMediaPathInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^data:image\//i.test(raw) || /^blob:/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return raw;

  const normalizedPath = raw
    .replace(/^(\.\.\/)+/, "")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "");

  if (!normalizedPath) return "";
  if (/^(uploads|storage)\//i.test(normalizedPath)) return `/${normalizedPath}`;
  if (/^[^?#]+\.(png|jpe?g|webp|gif|avif|svg)(?:[?#].*)?$/i.test(normalizedPath)) return `/${normalizedPath}`;
  return normalizedPath;
}

function normalizeImgurMediaUrl(value: string, fallbackExtension = ".png"): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (!["imgur.com", "www.imgur.com", "m.imgur.com", "i.imgur.com"].includes(host)) return raw;

    const pathSegments = String(parsed.pathname || "")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (pathSegments.length === 0) return raw;

    let candidate = "";
    if (host === "i.imgur.com") {
      candidate = pathSegments[0] || "";
    } else if (pathSegments.length === 1) {
      candidate = pathSegments[0] || "";
    } else {
      const prefix = String(pathSegments[0] || "").toLowerCase();
      if (["gallery", "g"].includes(prefix)) {
        candidate = pathSegments[1] || "";
      } else {
        return raw;
      }
    }

    const pathMatch = candidate.match(/^([a-z0-9]+)(\.[a-z0-9]+)?$/i);
    if (!pathMatch?.[1]) return raw;
    const normalizedFallback = String(fallbackExtension || ".png").trim().startsWith(".")
      ? String(fallbackExtension || ".png").trim()
      : `.${String(fallbackExtension || "png").trim()}`;
    const extension = String(pathMatch[2] || normalizedFallback).toLowerCase();
    return `https://i.imgur.com/${pathMatch[1]}${extension}${parsed.search || ""}${parsed.hash || ""}`;
  } catch (_error) {
    return raw;
  }
}

const IMGUR_IMAGE_FORM_FIELDS = new Set<keyof FormState>(["imageUrl", "cardImageUrl", "bannerUrl", "logoUrl"]);

function normalizeMediaUrlForField(field: keyof FormState, value: string): string {
  const normalized = normalizeUrlInput(String(value || ""));
  if (!normalized) return "";
  if (field === "trailerUrl") {
    return normalizeImgurMediaUrl(normalized, ".mp4");
  }
  if (IMGUR_IMAGE_FORM_FIELDS.has(field)) {
    return normalizeImgurMediaUrl(normalized, ".png");
  }
  return normalized;
}

function normalizeGalleryMediaUrl(value: string): string {
  return normalizeImgurMediaUrl(normalizeUrlInput(value), ".png");
}

function compactText(value: string, max = 44): string {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(12, max - 3))}...`;
}

function formatBytesLabel(value: string): string {
  const bytes = Number(String(value || "").trim());
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
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

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickFirstJsonValue(source: JsonObject, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function hasAnyJsonKey(source: JsonObject, keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function readImportText(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return fallback;
}

function readImportBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function readImportListText(value: unknown): string {
  if (Array.isArray(value)) {
    return uniqueList(
      value
        .map((entry) => readImportText(entry))
        .filter(Boolean)
    ).join("\n");
  }
  if (typeof value === "string") {
    return uniqueList(parseListText(value)).join("\n");
  }
  return "";
}

function normalizeArchiveTypeInput(value: unknown, fallback: "rar" | "zip" = "rar"): "rar" | "zip" {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return normalized === "zip" ? "zip" : "rar";
}

function normalizeImportedFormPayload(
  payload: unknown,
  currentForm: FormState,
  editorMode: "new" | "edit"
): FormState {
  if (!isJsonObject(payload)) {
    throw new Error("JSON invalido: objeto esperado.");
  }
  const rawSource = pickFirstJsonValue(payload, ["form", "game", "payload", "data"]);
  const source = isJsonObject(rawSource) ? rawSource : payload;

  const importedId = normalizeId(readImportText(pickFirstJsonValue(source, ["id", "slug", "gameId", "game_id"])));
  const baseId = editorMode === "edit" ? currentForm.id : importedId || currentForm.id;

  const steamUrlRaw = readImportText(
    pickFirstJsonValue(source, ["steamUrl", "steam_url", "steamStoreUrl", "steam_store_url"]),
    currentForm.steamUrl
  );
  const steamAppIdRaw = readImportText(
    pickFirstJsonValue(source, ["steamAppId", "steam_app_id"]),
    currentForm.steamAppId
  );
  const resolvedSteamId = extractSteamAppIdFromInput(steamUrlRaw || steamAppIdRaw);
  const normalizedSteamAppId = resolvedSteamId || (/^\d+$/.test(steamAppIdRaw) ? steamAppIdRaw : "");
  const normalizedSteamUrl = normalizedSteamAppId ? buildSteamStoreUrl(normalizedSteamAppId) : normalizeUrlInput(steamUrlRaw);

  const genreKeys = ["genres", "tags"];
  const galleryKeys = ["gallery", "screenshots", "images", "gallery_urls"];
  const downloadListKeys = ["downloadUrls", "download_urls", "downloadURLs"];
  const downloadSingleKeys = ["downloadUrl", "download_url"];

  const rawGenres = pickFirstJsonValue(source, genreKeys);
  const rawGallery = pickFirstJsonValue(source, galleryKeys);
  const galleryText = readImportListText(rawGallery);
  const normalizedGallery = uniqueList(parseListText(galleryText).map(normalizeGalleryMediaUrl)).join("\n");

  const rawDownloadUrls =
    pickFirstJsonValue(source, downloadListKeys) ??
    pickFirstJsonValue(source, downloadSingleKeys);
  const downloadUrlsText = readImportListText(rawDownloadUrls);
  const normalizedDownloadUrls = uniqueList(parseListText(downloadUrlsText).map(normalizeDownloadUrlInput)).join("\n");

  return {
    ...currentForm,
    id: baseId,
    name: readImportText(pickFirstJsonValue(source, ["name", "title"]), currentForm.name),
    section: readImportText(pickFirstJsonValue(source, ["section"]), currentForm.section),
    description: readImportText(pickFirstJsonValue(source, ["description", "shortDescription", "short_description"]), currentForm.description),
    longDescription: readImportText(
      pickFirstJsonValue(source, ["longDescription", "long_description", "fullDescription", "full_description"]),
      currentForm.longDescription
    ),
    archiveType: normalizeArchiveTypeInput(
      pickFirstJsonValue(source, ["archiveType", "archive_type"]),
      currentForm.archiveType
    ),
    archivePassword: readImportText(
      pickFirstJsonValue(source, ["archivePassword", "archive_password"]),
      currentForm.archivePassword
    ),
    installDirName: readImportText(
      pickFirstJsonValue(source, ["installDirName", "install_dir_name"]),
      currentForm.installDirName
    ),
    launchExecutable: readImportText(
      pickFirstJsonValue(source, ["launchExecutable", "launch_executable"]),
      currentForm.launchExecutable
    ),
    imageUrl: normalizeMediaUrlForField(
      "imageUrl",
      readImportText(pickFirstJsonValue(source, ["imageUrl", "image_url"]), currentForm.imageUrl)
    ),
    cardImageUrl: normalizeMediaUrlForField(
      "cardImageUrl",
      readImportText(pickFirstJsonValue(source, ["cardImageUrl", "card_image_url"]), currentForm.cardImageUrl)
    ),
    bannerUrl: normalizeMediaUrlForField(
      "bannerUrl",
      readImportText(pickFirstJsonValue(source, ["bannerUrl", "banner_url"]), currentForm.bannerUrl)
    ),
    logoUrl: normalizeMediaUrlForField(
      "logoUrl",
      readImportText(pickFirstJsonValue(source, ["logoUrl", "logo_url"]), currentForm.logoUrl)
    ),
    trailerUrl: normalizeMediaUrlForField(
      "trailerUrl",
      readImportText(pickFirstJsonValue(source, ["trailerUrl", "trailer_url"]), currentForm.trailerUrl)
    ),
    developedBy: readImportText(pickFirstJsonValue(source, ["developedBy", "developed_by"]), currentForm.developedBy),
    publishedBy: readImportText(pickFirstJsonValue(source, ["publishedBy", "published_by"]), currentForm.publishedBy),
    releaseDate: (() => {
      const importedReleaseDate = readImportText(
        pickFirstJsonValue(source, ["releaseDate", "release_date"]),
        currentForm.releaseDate
      );
      const normalizedReleaseDate = normalizeReleaseDateInput(importedReleaseDate);
      return normalizedReleaseDate || importedReleaseDate;
    })(),
    steamAppId: normalizedSteamAppId,
    steamUrl: normalizedSteamUrl,
    genres: hasAnyJsonKey(source, genreKeys) ? readImportListText(rawGenres) : currentForm.genres,
    gallery: hasAnyJsonKey(source, galleryKeys) ? normalizedGallery : currentForm.gallery,
    downloadUrls:
      hasAnyJsonKey(source, downloadListKeys) || hasAnyJsonKey(source, downloadSingleKeys)
        ? normalizedDownloadUrls
        : currentForm.downloadUrls,
    sizeBytes: readImportText(pickFirstJsonValue(source, ["sizeBytes", "size_bytes"]), currentForm.sizeBytes),
    sizeLabel: readImportText(pickFirstJsonValue(source, ["sizeLabel", "size_label"]), currentForm.sizeLabel),
    currentPrice: readImportText(pickFirstJsonValue(source, ["currentPrice", "current_price"]), currentForm.currentPrice),
    originalPrice: readImportText(pickFirstJsonValue(source, ["originalPrice", "original_price"]), currentForm.originalPrice),
    discountPercent: readImportText(
      pickFirstJsonValue(source, ["discountPercent", "discount_percent"]),
      currentForm.discountPercent
    ),
    sortOrder: readImportText(pickFirstJsonValue(source, ["sortOrder", "sort_order"]), currentForm.sortOrder),
    free: readImportBoolean(pickFirstJsonValue(source, ["free"]), currentForm.free),
    exclusive: readImportBoolean(pickFirstJsonValue(source, ["exclusive"]), currentForm.exclusive),
    comingSoon: readImportBoolean(
      pickFirstJsonValue(source, ["comingSoon", "coming_soon"]),
      currentForm.comingSoon
    ),
    enabled: readImportBoolean(pickFirstJsonValue(source, ["enabled"]), currentForm.enabled)
  };
}

function buildEditorJsonPayload(
  form: FormState,
  options: { mode: "new" | "edit"; gameId: string; archiveFileName: string; includeExportedAt?: boolean }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    version: 1,
    source: "wplay-admin",
    mode: options.mode,
    gameId: String(options.gameId || "").trim(),
    archiveFileName: String(options.archiveFileName || "").trim(),
    form: sanitizeFormForSnapshot(form)
  };
  if (options.includeExportedAt) {
    payload.exportedAt = new Date().toISOString();
  }
  return payload;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      // Fallback below.
    }
  }
  if (typeof document === "undefined") return false;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "readonly");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.focus();
  area.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_error) {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}

function sanitizeFormForSnapshot(form: FormState): FormState {
  return {
    ...form,
    id: normalizeId(form.id),
    name: String(form.name || "").trim(),
    section: String(form.section || "").trim(),
    description: String(form.description || "").trim(),
    longDescription: String(form.longDescription || "").trim(),
    archivePassword: String(form.archivePassword || "").trim(),
    installDirName: String(form.installDirName || "").trim(),
    launchExecutable: String(form.launchExecutable || "").trim(),
    imageUrl: normalizeMediaUrlForField("imageUrl", form.imageUrl),
    cardImageUrl: normalizeMediaUrlForField("cardImageUrl", form.cardImageUrl),
    bannerUrl: normalizeMediaUrlForField("bannerUrl", form.bannerUrl),
    logoUrl: normalizeMediaUrlForField("logoUrl", form.logoUrl),
    trailerUrl: normalizeMediaUrlForField("trailerUrl", form.trailerUrl),
    developedBy: String(form.developedBy || "").trim(),
    publishedBy: String(form.publishedBy || "").trim(),
    releaseDate: normalizeReleaseDateInput(String(form.releaseDate || "")) || String(form.releaseDate || "").trim(),
    steamAppId: String(form.steamAppId || "").trim(),
    steamUrl: normalizeUrlInput(form.steamUrl),
    genres: uniqueList(parseListText(form.genres)).join("\n"),
    gallery: uniqueList(parseListText(form.gallery).map(normalizeGalleryMediaUrl)).join("\n"),
    downloadUrls: uniqueList(parseListText(form.downloadUrls).map(normalizeDownloadUrlInput)).join("\n"),
    sizeBytes: String(form.sizeBytes || "").trim(),
    sizeLabel: String(form.sizeLabel || "").trim(),
    currentPrice: String(form.currentPrice || "").trim(),
    originalPrice: String(form.originalPrice || "").trim(),
    discountPercent: String(form.discountPercent || "").trim(),
    sortOrder: String(form.sortOrder || "").trim()
  };
}

function createFormSnapshot(form: FormState, options?: { mode?: string; gameId?: string; archiveKey?: string }): string {
  return JSON.stringify({
    mode: String(options?.mode || ""),
    gameId: String(options?.gameId || ""),
    archiveKey: String(options?.archiveKey || ""),
    form: sanitizeFormForSnapshot(form)
  });
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("pt-BR");
}

function normalizeMaintenanceFlag(payload: unknown): MaintenanceFlag {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const dataRaw = row.data;
  const data =
    dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)
      ? (dataRaw as Record<string, unknown>)
      : DEFAULT_MAINTENANCE_FLAG.data;
  const enabledRaw = row.enabled;
  const enabled =
    enabledRaw === true ||
    String(enabledRaw ?? "")
      .trim()
      .toLowerCase() === "true" ||
    String(enabledRaw ?? "").trim() === "1";
  return {
    id: String(row.id || DEFAULT_MAINTENANCE_FLAG.id),
    enabled,
    title: String(row.title || DEFAULT_MAINTENANCE_FLAG.title),
    message: String(row.message || DEFAULT_MAINTENANCE_FLAG.message),
    data,
    createdAt: String(row.createdAt || row.created_at || ""),
    updatedAt: String(row.updatedAt || row.updated_at || "")
  };
}

function filenameToGameName(fileName: string): string {
  const base = String(fileName || "")
    .replace(/\.(rar|zip)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function isSupportedArchiveFileName(fileName: string): boolean {
  const lower = String(fileName || "")
    .trim()
    .toLowerCase();
  return lower.endsWith(".rar") || lower.endsWith(".zip");
}

function parseHttpUrlInput(value: string): URL | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function isGoogleDriveFolderLink(value: string): boolean {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) return false;
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("drive.google.com")) return false;
  return /\/folders\/[a-zA-Z0-9_-]+/i.test(parsed.pathname);
}

function extractGoogleDriveFileIdFromInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z0-9_-]{16,}$/.test(raw) && !raw.includes("/")) return raw;

  const parsed = parseHttpUrlInput(raw);
  if (!parsed) return "";
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("drive.google.com") && !host.includes("drive.usercontent.google.com")) return "";

  const byPath = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i)?.[1];
  if (byPath) return byPath;

  const byQuery =
    String(parsed.searchParams.get("id") || "").trim() || String(parsed.searchParams.get("fileId") || "").trim();
  if (byQuery && /^[a-zA-Z0-9_-]{16,}$/.test(byQuery)) return byQuery;

  return "";
}

function buildGoogleDriveDirectDownloadUrl(fileId: string): string {
  const clean = String(fileId || "").trim();
  if (!clean) return "";
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(clean)}`;
}

function isDropboxLink(value: string): boolean {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) return false;
  const host = String(parsed.hostname || "").toLowerCase();
  return host.includes("dropbox.com") || host.includes("dropboxusercontent.com");
}

function isDropboxFolderLink(value: string): boolean {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) return false;
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("dropbox.com") && !host.includes("dropboxusercontent.com")) return false;
  const pathName = String(parsed.pathname || "").toLowerCase();
  return (
    pathName.startsWith("/home") ||
    pathName.includes("/scl/fo/") ||
    pathName.includes("/sh/") ||
    pathName.includes("/folder/")
  );
}

function buildDropboxDirectDownloadUrl(value: string): string {
  const parsed = parseHttpUrlInput(value);
  if (!parsed) return "";
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.includes("dropbox.com") && !host.includes("dropboxusercontent.com")) return "";
  if (host.includes("dropbox.com") && !host.includes("dropboxusercontent.com")) {
    parsed.searchParams.delete("raw");
    parsed.searchParams.set("dl", "1");
  }
  return parsed.toString();
}

function resolveDownloadUrlInput(value: string): { url: string; driveFileId: string } {
  const normalizedInput = normalizeUrlInput(value);
  if (!normalizedInput) {
    return { url: "", driveFileId: "" };
  }

  const driveFileId = extractGoogleDriveFileIdFromInput(normalizedInput);
  if (driveFileId) {
    return {
      url: buildGoogleDriveDirectDownloadUrl(driveFileId) || normalizedInput,
      driveFileId
    };
  }

  const parsed = parseHttpUrlInput(normalizedInput);
  if (!parsed) {
    return { url: "", driveFileId: "" };
  }

  const normalizedHttpUrl = parsed.toString();
  const dropboxDirectLink = buildDropboxDirectDownloadUrl(normalizedHttpUrl);
  return {
    url: dropboxDirectLink || normalizedHttpUrl,
    driveFileId: ""
  };
}

function normalizeDownloadUrlInput(value: string): string {
  const resolved = resolveDownloadUrlInput(value);
  if (resolved.url) {
    return resolved.url;
  }
  return normalizeUrlInput(value);
}

function extractSteamAppIdFromInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw) && Number(raw) > 0) return raw;

  const directPathMatch = raw.match(/\/app\/(\d+)/i);
  if (directPathMatch?.[1]) return directPathMatch[1];

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const pathMatch = parsed.pathname.match(/\/app\/(\d+)/i);
    if (pathMatch?.[1]) return pathMatch[1];
    const queryId =
      parsed.searchParams.get("appid") ||
      parsed.searchParams.get("appId") ||
      parsed.searchParams.get("id");
    if (queryId && /^\d+$/.test(queryId) && Number(queryId) > 0) return queryId;
  } catch (_error) {
    return "";
  }

  return "";
}

function buildSteamStoreUrl(appId: string): string {
  const clean = String(appId || "").trim();
  if (!/^\d+$/.test(clean) || Number(clean) <= 0) return "";
  return `https://store.steampowered.com/app/${clean}`;
}

function sanitizeMediaUrl(value: unknown): string {
  const normalized = normalizeMediaPathInput(normalizeUrlInput(String(value ?? "")));
  const lower = normalized.toLowerCase();
  if (!normalized || lower === "null" || lower === "undefined" || lower === "n/a") {
    return "";
  }
  return normalizeImgurMediaUrl(normalized);
}

function coverCandidates(game: LauncherGame): string[] {
  const candidates = [
    sanitizeMediaUrl(game.card_image_url),
    sanitizeMediaUrl(game.cardImageUrl),
    sanitizeMediaUrl(game.image_url),
    sanitizeMediaUrl(game.imageUrl),
    sanitizeMediaUrl(game.banner_url),
    sanitizeMediaUrl(game.bannerUrl),
    ...((Array.isArray(game.gallery) ? game.gallery : []).map((entry) => sanitizeMediaUrl(entry))),
    sanitizeMediaUrl(game.logo_url),
    sanitizeMediaUrl(game.logoUrl)
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function coverUrl(game: LauncherGame): string {
  return coverCandidates(game)[0] || "";
}

function reorderGamesByDropIndex(games: LauncherGame[], draggedId: string, dropIndex: number): LauncherGame[] {
  const normalizedDraggedId = String(draggedId || "").trim();
  if (!normalizedDraggedId) {
    return games;
  }

  const fromIndex = games.findIndex((game) => game.id === normalizedDraggedId);
  if (fromIndex < 0) {
    return games;
  }

  const draggedGame = games[fromIndex];
  if (!draggedGame) {
    return games;
  }

  const withoutDragged = games.filter((game) => game.id !== normalizedDraggedId);
  const safeDropIndex = Math.max(0, Math.min(Math.trunc(dropIndex), withoutDragged.length));
  withoutDragged.splice(safeDropIndex, 0, draggedGame);
  return withoutDragged;
}

function hasSameGameOrder(left: LauncherGame[], right: LauncherGame[]): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.id !== right[index]?.id) {
      return false;
    }
  }
  return true;
}

function withSequentialSortOrder(games: LauncherGame[]): LauncherGame[] {
  return games.map((game, index) => ({
    ...game,
    sort_order: (index + 1) * 10
  }));
}

function onGameCardImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  const encodedCandidates = String(image.dataset.coverCandidates || "").trim();
  const candidates = encodedCandidates
    .split("|")
    .map((entry) => decodeURIComponent(entry))
    .map((entry) => sanitizeMediaUrl(entry))
    .filter(Boolean);
  const currentIndex = Number(image.dataset.coverIndex || "0");
  const nextIndex = Number.isFinite(currentIndex) ? currentIndex + 1 : 1;
  if (nextIndex < candidates.length) {
    image.dataset.coverIndex = String(nextIndex);
    image.src = candidates[nextIndex];
    return;
  }
  image.classList.add("is-broken");
}

function gameToForm(game: LauncherGame): FormState {
  return {
    id: game.id || "",
    name: game.name || "",
    section: game.section || "Catalogo",
    description: game.description || "",
    longDescription: game.long_description || "",
    archiveType: game.archive_type === "zip" ? "zip" : "rar",
    archivePassword: game.archive_password || "online-fix.me",
    installDirName: game.install_dir_name || "",
    launchExecutable: game.launch_executable || "",
    imageUrl: game.image_url || "",
    cardImageUrl: game.card_image_url || "",
    bannerUrl: game.banner_url || "",
    logoUrl: game.logo_url || "",
    trailerUrl: game.trailer_url || "",
    developedBy: game.developed_by || "",
    publishedBy: game.published_by || "WPlay Games - OnlineFix",
    releaseDate: game.release_date || "",
    steamAppId: game.steam_app_id > 0 ? String(game.steam_app_id) : "",
    steamUrl: game.steam_app_id > 0 ? `https://store.steampowered.com/app/${game.steam_app_id}` : "",
    genres: toListText(game.genres),
    gallery: toListText(game.gallery),
    downloadUrls: toListText((Array.isArray(game.download_urls) ? game.download_urls : []).map(normalizeDownloadUrlInput)),
    sizeBytes: game.size_bytes || "",
    sizeLabel: game.size_label || "",
    currentPrice: game.current_price || "Grátis",
    originalPrice: game.original_price || "",
    discountPercent: game.discount_percent || "0%",
    sortOrder: String(game.sort_order || 100),
    free: Boolean(game.free),
    exclusive: Boolean(game.exclusive),
    comingSoon: Boolean(game.coming_soon),
    enabled: Boolean(game.enabled)
  };
}

function authQueryMessage(searchParams: URLSearchParams): string {
  const error = searchParams.get("error");
  if (error === "steam-key-missing") return "Login Steam indisponivel na configuracao atual do servidor.";
  if (error === "steam-disabled") return "Login Steam desativado no servidor.";
  if (error === "steam-login" || error === "steam-callback") return "Falha no login Steam.";
  if (error === "not-admin") return "Sua Steam nao esta autorizada para este painel.";
  if (error === "admin-storage") return "Nao foi possivel validar staff no banco de dados.";
  if (searchParams.get("login") === "ok") return "Login Steam validado com sucesso.";
  return "";
}

function buildDirectSteamOpenIdUrl(baseUrl: string): string {
  const normalizedBase = String(baseUrl || "").replace(/\/+$/g, "");
  const returnToUrl = `${normalizedBase}/api/auth/steam/return`;
  const endpoint = new URL("https://steamcommunity.com/openid/login");
  endpoint.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  endpoint.searchParams.set("openid.mode", "checkid_setup");
  endpoint.searchParams.set("openid.return_to", returnToUrl);
  endpoint.searchParams.set("openid.realm", normalizedBase);
  endpoint.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  endpoint.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return endpoint.toString();
}

function normalizeStaffRole(roleRaw: string): "developer" | "administrador" | "staff" {
  const role = String(roleRaw || "")
    .trim()
    .toLowerCase();
  if (["developer", "dev", "super-admin", "super_admin", "superadmin", "owner"].includes(role)) {
    return "developer";
  }
  if (["administrador", "admin", "administrator", "manager", "gerente"].includes(role)) {
    return "administrador";
  }
  return "staff";
}

function formatRoleLabel(roleRaw: string): string {
  const role = normalizeStaffRole(roleRaw);
  if (role === "developer") return "Developer";
  if (role === "administrador") return "Administrador";
  return "Staff";
}

function resolveStaffAvatarUrl(admin: AdminRecord): string {
  return String(admin?.steamProfile?.avatar || admin?.steamProfile?.avatarUrl || "").trim();
}

function extractSteamIdFromStaffInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const direct = raw.match(/\b\d{17}\b/);
  if (direct?.[0]) return direct[0];

  const candidateUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidateUrl);
    const fromPath = parsed.pathname.match(/\/profiles\/(\d{17})(?:\/|$)/i)?.[1];
    if (fromPath) return fromPath;
    const fromQuery = String(parsed.searchParams.get("steamid") || "").trim();
    if (/^\d{17}$/.test(fromQuery)) return fromQuery;
  } catch (_error) {
    return "";
  }

  return "";
}

export function AdminAppClient() {
  const [viewer, setViewer] = useState<ViewerState>(EMPTY_VIEWER);
  const [viewerLoading, setViewerLoading] = useState(false);

  const [games, setGames] = useState<LauncherGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [staffSteamId, setStaffSteamId] = useState("");
  const [staffRole, setStaffRole] = useState<"developer" | "administrador" | "staff">("staff");
  const [isAddStaffModalOpen, setIsAddStaffModalOpen] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState("");
  const [editingStaffRole, setEditingStaffRole] = useState<"developer" | "administrador" | "staff">("staff");
  const [maintenanceFlag, setMaintenanceFlag] = useState<MaintenanceFlag>(DEFAULT_MAINTENANCE_FLAG);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);
  const [maintenanceTitleDraft, setMaintenanceTitleDraft] = useState(DEFAULT_MAINTENANCE_FLAG.title);
  const [maintenanceMessageDraft, setMaintenanceMessageDraft] = useState(DEFAULT_MAINTENANCE_FLAG.message);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);

  const [view, setView] = useState<"catalog" | "editor">("catalog");
  const [dashboardSection, setDashboardSection] = useState<"inicio" | "jogos" | "administracao">("inicio");
  const [editorMode, setEditorMode] = useState<"new" | "edit">("new");
  const [editingGameId, setEditingGameId] = useState("");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [driveLinkStageInput, setDriveLinkStageInput] = useState("");
  const [linkedDriveFileId, setLinkedDriveFileId] = useState("");
  const [linkedDriveUrl, setLinkedDriveUrl] = useState("");
  const [allowMetadataWithoutDownloadSource, setAllowMetadataWithoutDownloadSource] = useState(false);
  const [isArchiveDragActive, setIsArchiveDragActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPrimaryDownload, setIsSavingPrimaryDownload] = useState(false);
  const [isRemovingGame, setIsRemovingGame] = useState(false);
  const [isManagingStaff, setIsManagingStaff] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [editorLayoutMode, setEditorLayoutMode] = useState<"simplified" | "complete">("simplified");
  const [showAdvancedInSimplified, setShowAdvancedInSimplified] = useState(true);
  const [draggedGalleryIndex, setDraggedGalleryIndex] = useState<number | null>(null);
  const [galleryDropIndex, setGalleryDropIndex] = useState<number | null>(null);
  const [draggedCatalogGameId, setDraggedCatalogGameId] = useState("");
  const [catalogDropTargetGameId, setCatalogDropTargetGameId] = useState("");
  const [catalogDropPlacement, setCatalogDropPlacement] = useState<"before" | "after">("after");
  const [isSavingCatalogOrder, setIsSavingCatalogOrder] = useState(false);
  const [isPrimaryDownloadModalOpen, setIsPrimaryDownloadModalOpen] = useState(false);
  const [primaryDownloadDraft, setPrimaryDownloadDraft] = useState("");
  const [draftUpdatedAt, setDraftUpdatedAt] = useState("");
  const [isJsonImportOpen, setIsJsonImportOpen] = useState(false);
  const [jsonImportInput, setJsonImportInput] = useState("");
  const [notice, setNotice] = useState<{ msg: string; error: boolean }>({ msg: "", error: false });
  const [confirm, setConfirm] = useState<{ show: boolean; gameId: string; at: string }>({
    show: false,
    gameId: "",
    at: ""
  });
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [gameRemovalTarget, setGameRemovalTarget] = useState<LauncherGame | null>(null);
  const [authMsg, setAuthMsg] = useState("");
  const [genreInput, setGenreInput] = useState("");
  const [galleryInput, setGalleryInput] = useState("");
  const [baseSnapshot, setBaseSnapshot] = useState(createFormSnapshot(INITIAL_FORM, { mode: "new" }));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const galleryUploadInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const archiveDragDepthRef = useRef(0);
  const noticeHideTimerRef = useRef<number | null>(null);
  const noticeHoveredRef = useRef(false);
  const catalogDragSnapshotRef = useRef<LauncherGame[] | null>(null);
  const catalogLastDropSignatureRef = useRef("");

  const suggestedId = useMemo(() => normalizeId(form.name), [form.name]);
  const resolvedId = useMemo(() => normalizeId(form.id || suggestedId), [form.id, suggestedId]);
  const editingGame = useMemo(() => games.find((item) => item.id === editingGameId) || null, [games, editingGameId]);

  const filteredGames = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return games;
    return games.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(term));
  }, [games, search]);

  const genreItems = useMemo(() => uniqueList(parseListText(form.genres)), [form.genres]);
  const galleryItems = useMemo(() => uniqueList(parseListText(form.gallery)), [form.gallery]);
  const downloadUrlItems = useMemo(
    () => uniqueList(parseListText(form.downloadUrls).map(normalizeDownloadUrlInput)),
    [form.downloadUrls]
  );
  const hasPersistedDownloadSource = useMemo(
    () =>
      Boolean(
        String(editingGame?.google_drive_file_id || "").trim() ||
          normalizeDownloadUrlInput(String(editingGame?.download_url || "")) ||
          (Array.isArray(editingGame?.download_urls) &&
            editingGame.download_urls.some((entry) => Boolean(normalizeDownloadUrlInput(String(entry || "")))))
      ),
    [editingGame?.google_drive_file_id, editingGame?.download_url, editingGame?.download_urls]
  );
  const hasAnyDownloadSource = useMemo(
    () =>
      Boolean(
        archiveFile ||
          linkedDriveFileId ||
          normalizeDownloadUrlInput(linkedDriveUrl) ||
          downloadUrlItems.length > 0 ||
          (editorMode === "edit" && hasPersistedDownloadSource)
      ),
    [archiveFile, linkedDriveFileId, linkedDriveUrl, downloadUrlItems.length, editorMode, hasPersistedDownloadSource]
  );
  const archiveDescriptor = useMemo(
    () => {
      if (archiveFile) return `${archiveFile.name}:${archiveFile.size}`;
      if (linkedDriveUrl) return linkedDriveFileId ? `drive:${linkedDriveFileId}` : `remote:${linkedDriveUrl}`;
      if (linkedDriveFileId) return `drive:${linkedDriveFileId}`;
      return "";
    },
    [archiveFile, linkedDriveFileId, linkedDriveUrl]
  );
  const currentSnapshot = useMemo(
    () => createFormSnapshot(form, { mode: editorMode, gameId: editingGameId, archiveKey: archiveDescriptor }),
    [form, editorMode, editingGameId, archiveDescriptor]
  );
  const showUploadOnlyStage = useMemo(
    () =>
      view === "editor" &&
      editorMode === "new" &&
      !allowMetadataWithoutDownloadSource &&
      !archiveFile &&
      !linkedDriveUrl,
    [view, editorMode, allowMetadataWithoutDownloadSource, archiveFile, linkedDriveUrl]
  );
  const isDirty = useMemo(
    () => view === "editor" && currentSnapshot !== baseSnapshot,
    [view, currentSnapshot, baseSnapshot]
  );

  const cardPreviewUrl = useMemo(
    () => sanitizeMediaUrl(form.cardImageUrl || form.imageUrl || galleryItems[0] || ""),
    [form.cardImageUrl, form.imageUrl, galleryItems]
  );
  const liveEditorJson = useMemo(
    () =>
      JSON.stringify(
        buildEditorJsonPayload(form, {
          mode: editorMode,
          gameId: editingGameId || resolvedId,
          archiveFileName:
            archiveFile?.name ||
            (linkedDriveFileId ? `drive:${linkedDriveFileId}` : linkedDriveUrl ? `remote:${linkedDriveUrl}` : "")
        }),
        null,
        2
      ),
    [form, editorMode, editingGameId, resolvedId, archiveFile?.name, linkedDriveFileId, linkedDriveUrl]
  );

  const isReleaseDateValid = useMemo(
    () => {
      const raw = String(form.releaseDate || "").trim();
      if (!raw) return true;
      return Boolean(normalizeReleaseDateInput(raw));
    },
    [form.releaseDate]
  );

  const isSteamIdValid = useMemo(() => {
    const steamUrl = form.steamUrl.trim();
    if (!steamUrl) return true;
    return Boolean(extractSteamAppIdFromInput(steamUrl));
  }, [form.steamUrl]);

  const editorChecklist = useMemo(
    () => [
      { label: "Nome e ID prontos", ok: Boolean(form.name.trim() && resolvedId) },
      {
        label: "Arquivo vinculado",
        ok: Boolean(
          archiveFile ||
            linkedDriveUrl ||
            linkedDriveFileId ||
            editingGame?.google_drive_file_id ||
            editingGame?.download_url ||
            editingGame?.download_urls?.[0] ||
            form.comingSoon
        )
      },
      { label: "Capa configurada", ok: Boolean(cardPreviewUrl) },
      { label: "Galeria com imagem", ok: galleryItems.length > 0 },
      { label: "Download URL preenchida", ok: downloadUrlItems.length > 0 },
      { label: "Steam app ID valido", ok: isSteamIdValid && Number(form.steamAppId.trim() || "0") > 0 }
    ],
    [
      form.name,
      resolvedId,
      archiveFile,
      linkedDriveUrl,
      linkedDriveFileId,
      editingGame?.google_drive_file_id,
      editingGame?.download_url,
      editingGame?.download_urls,
      cardPreviewUrl,
      galleryItems.length,
      downloadUrlItems.length,
      isSteamIdValid,
      form.steamAppId,
      form.comingSoon
    ]
  );

  const completionPercent = useMemo(() => {
    const total = editorChecklist.length;
    if (total === 0) return 0;
    const completed = editorChecklist.filter((item) => item.ok).length;
    return Math.round((completed / total) * 100);
  }, [editorChecklist]);

  const shouldShowAdvancedFields = editorLayoutMode === "complete" || showAdvancedInSimplified;
  const enabledGamesCount = useMemo(() => games.filter((game) => game.enabled).length, [games]);
  const disabledGamesCount = useMemo(() => games.filter((game) => !game.enabled).length, [games]);
  const latestCatalogUpdate = useMemo(() => {
    const best = games.reduce((latest, game) => {
      const timestamp = new Date(game.updated_at || "").getTime();
      if (!Number.isFinite(timestamp)) return latest;
      return timestamp > latest ? timestamp : latest;
    }, 0);
    return best > 0 ? new Date(best).toISOString() : "";
  }, [games]);
  const viewerRole = useMemo(() => normalizeStaffRole(viewer.role || "staff"), [viewer.role]);
  const viewerPermissions = useMemo(
    () =>
      viewer.permissions || {
        manageStaff: false,
        publishGame: false,
        editGame: false,
        removeGame: false,
        manageMaintenance: false
      },
    [viewer.permissions]
  );
  const canManageStaff = Boolean(viewerPermissions.manageStaff);
  const canPublishGames = Boolean(viewerPermissions.publishGame);
  const canEditGames = Boolean(viewerPermissions.editGame);
  const canRemoveGames = Boolean(viewerPermissions.removeGame);
  const canManageMaintenance = Boolean(viewerPermissions.manageMaintenance);
  const isStaffViewer = viewerRole === "staff";
  const isCatalogReorderEnabled = canEditGames && search.trim().length === 0 && !gamesLoading && !isSavingCatalogOrder;
  const catalogDragActive = Boolean(draggedCatalogGameId);
  const draggedCatalogGame = useMemo(
    () => games.find((game) => game.id === draggedCatalogGameId) || null,
    [games, draggedCatalogGameId]
  );
  const editingStaffRecord = useMemo(
    () => admins.find((entry) => entry.steamId === editingStaffId) || null,
    [admins, editingStaffId]
  );
  const primaryDownloadLink = useMemo(() => {
    const fromLinked = normalizeDownloadUrlInput(linkedDriveUrl);
    if (fromLinked) {
      return fromLinked;
    }
    const fromEditing = normalizeDownloadUrlInput(editingGame?.download_url || editingGame?.download_urls?.[0] || "");
    if (fromEditing) {
      return fromEditing;
    }
    const fromForm = normalizeDownloadUrlInput(parseListText(form.downloadUrls)[0] || "");
    return fromForm;
  }, [linkedDriveUrl, editingGame?.download_url, editingGame?.download_urls, form.downloadUrls]);
  const extractedStaffSteamId = useMemo(() => extractSteamIdFromStaffInput(staffSteamId), [staffSteamId]);
  const viewerDisplayName = String(viewer.user?.displayName || "Steam User").trim() || "Steam User";
  const viewerSteamId = String(viewer.user?.steamId || "").trim();
  const viewerAvatarInitial = viewerDisplayName.slice(0, 1).toUpperCase() || "U";

  function clearNoticeHideTimer() {
    if (noticeHideTimerRef.current !== null) {
      window.clearTimeout(noticeHideTimerRef.current);
      noticeHideTimerRef.current = null;
    }
  }

  function scheduleNoticeHideTimer(delayMs = NOTICE_AUTO_HIDE_MS) {
    clearNoticeHideTimer();
    if (!notice.msg || noticeHoveredRef.current) {
      return;
    }
    noticeHideTimerRef.current = window.setTimeout(() => {
      noticeHideTimerRef.current = null;
      setNotice((prev) => {
        if (!prev.msg || noticeHoveredRef.current) {
          return prev;
        }
        return { msg: "", error: false };
      });
    }, delayMs);
  }

  function handleNoticeMouseEnter() {
    noticeHoveredRef.current = true;
    clearNoticeHideTimer();
  }

  function handleNoticeMouseLeave() {
    noticeHoveredRef.current = false;
    if (notice.msg) {
      scheduleNoticeHideTimer(NOTICE_AUTO_HIDE_MS);
    }
  }

  function setNoticeState(msg: string, error = false) {
    setNotice({ msg, error });
  }

  function normalizeFormFieldUpdate<K extends keyof FormState>(key: K, value: FormState[K]): FormState[K] {
    if (typeof value !== "string") {
      return value;
    }
    if (key === "imageUrl" || key === "cardImageUrl" || key === "bannerUrl" || key === "logoUrl" || key === "trailerUrl") {
      return normalizeMediaUrlForField(key, value) as FormState[K];
    }
    return value;
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    const nextValue = normalizeFormFieldUpdate(key, value);
    setForm((prev) => ({ ...prev, [key]: nextValue }));
  }

  function clearEditorDraft() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(EDITOR_DRAFT_STORAGE_KEY);
    }
    setDraftUpdatedAt("");
  }

  function readEditorDraft(): EditorDraft | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(EDITOR_DRAFT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as EditorDraft;
      if (!parsed || typeof parsed !== "object" || !parsed.form) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function restoreEditorDraft() {
    const draft = readEditorDraft();
    if (!draft) {
      setNoticeState("Nenhum rascunho encontrado para restaurar.", true);
      return;
    }
    const draftSteamUrl = normalizeUrlInput(String(draft.form?.steamUrl || ""));
    const draftSteamIdRaw = String(draft.form?.steamAppId || "").trim() === "0" ? "" : String(draft.form?.steamAppId || "").trim();
    const resolvedSteamId = extractSteamAppIdFromInput(draftSteamUrl || draftSteamIdRaw);
    const fixedDraftForm: FormState = {
      ...draft.form,
      steamAppId: resolvedSteamId,
      steamUrl: resolvedSteamId ? buildSteamStoreUrl(resolvedSteamId) : draftSteamUrl
    };
    const restoredLinkedDriveFileId = String(draft.linkedDriveFileId || "").trim();
    const restoredLinkedDriveUrl = normalizeUrlInput(String(draft.linkedDriveUrl || ""));
    const restoredDownloadUrls = uniqueList(parseListText(fixedDraftForm.downloadUrls).map(normalizeDownloadUrlInput));
    const restoredHasSource = Boolean(restoredLinkedDriveFileId || restoredLinkedDriveUrl || restoredDownloadUrls.length > 0);
    setForm(fixedDraftForm);
    setGenreInput(String(draft.genreInput || ""));
    setGalleryInput(String(draft.galleryInput || ""));
    setLinkedDriveFileId(restoredLinkedDriveFileId);
    setLinkedDriveUrl(restoredLinkedDriveUrl);
    setDriveLinkStageInput(restoredLinkedDriveUrl);
    setAllowMetadataWithoutDownloadSource(!restoredHasSource && Boolean(fixedDraftForm.comingSoon));
    setBaseSnapshot(createFormSnapshot(fixedDraftForm, { mode: "new", archiveKey: "" }));
    setDraftUpdatedAt(String(draft.updatedAt || ""));
    setNoticeState("Rascunho restaurado.", false);
  }

  function confirmDiscardChanges(): boolean {
    if (!isDirty || typeof window === "undefined") return true;
    return window.confirm("Existem alteracoes nao salvas. Deseja continuar e descartar essas alteracoes?");
  }

  function leaveEditor() {
    if (!confirmDiscardChanges()) return;
    setView("catalog");
  }

  function applyGalleryAsMainMedia() {
    const first = normalizeUrlInput(galleryItems[0] || "");
    if (!first) {
      setNoticeState("Adicione ao menos uma imagem na galeria para usar esta acao.", true);
      return;
    }
    setForm((prev) => ({
      ...prev,
      cardImageUrl: first,
      imageUrl: prev.imageUrl.trim() || first,
      bannerUrl: prev.bannerUrl.trim() || first,
      logoUrl: prev.logoUrl.trim() || first
    }));
    setNoticeState("Midia principal preenchida pela primeira imagem da galeria.", false);
  }

  function syncAllMediaWithCard() {
    const cover = normalizeUrlInput(form.cardImageUrl || form.imageUrl || galleryItems[0] || "");
    if (!cover) {
      setNoticeState("Defina uma imagem de capa para sincronizar as midias.", true);
      return;
    }
    setForm((prev) => ({
      ...prev,
      cardImageUrl: cover,
      imageUrl: cover,
      bannerUrl: cover,
      logoUrl: prev.logoUrl.trim() || cover
    }));
    setNoticeState("Campos de midia sincronizados com a capa.", false);
  }

  function applyFreePricingPreset() {
    setForm((prev) => ({
      ...prev,
      free: true,
      currentPrice: "Grátis",
      originalPrice: prev.originalPrice.trim() || "R$ 0,00",
      discountPercent: "100%"
    }));
    setNoticeState("Preset de jogo gratuito aplicado.", false);
  }

  function applySizeLabelFromBytes() {
    const nextLabel = formatBytesLabel(form.sizeBytes);
    if (!nextLabel) {
      setNoticeState("Informe size_bytes valido para gerar size_label.", true);
      return;
    }
    updateField("sizeLabel", nextLabel);
    setNoticeState(`size_label atualizado para ${nextLabel}.`, false);
  }

  function normalizeUrlFields() {
    setForm((prev) => ({
      ...prev,
      imageUrl: normalizeMediaUrlForField("imageUrl", prev.imageUrl),
      cardImageUrl: normalizeMediaUrlForField("cardImageUrl", prev.cardImageUrl),
      bannerUrl: normalizeMediaUrlForField("bannerUrl", prev.bannerUrl),
      logoUrl: normalizeMediaUrlForField("logoUrl", prev.logoUrl),
      trailerUrl: normalizeMediaUrlForField("trailerUrl", prev.trailerUrl),
      steamAppId: extractSteamAppIdFromInput(prev.steamUrl || prev.steamAppId),
      steamUrl: (() => {
        const steamId = extractSteamAppIdFromInput(prev.steamUrl || prev.steamAppId);
        if (steamId) return buildSteamStoreUrl(steamId);
        return normalizeUrlInput(prev.steamUrl);
      })(),
      gallery: uniqueList(parseListText(prev.gallery).map(normalizeGalleryMediaUrl)).join("\n"),
      downloadUrls: uniqueList(parseListText(prev.downloadUrls).map(normalizeDownloadUrlInput)).join("\n")
    }));
    setNoticeState("URLs normalizadas com sucesso.", false);
  }

  function normalizeReleaseDateField(notify = false) {
    const rawReleaseDate = String(form.releaseDate || "").trim();
    if (!rawReleaseDate) {
      return true;
    }
    const normalizedReleaseDate = normalizeReleaseDateInput(rawReleaseDate);
    if (!normalizedReleaseDate) {
      if (notify) {
        setNoticeState("Nao foi possivel interpretar a release_date. Use uma data valida.", true);
      }
      return false;
    }
    if (normalizedReleaseDate !== rawReleaseDate) {
      updateField("releaseDate", normalizedReleaseDate);
      if (notify) {
        setNoticeState(`release_date ajustada para ${normalizedReleaseDate}.`, false);
      }
    }
    return true;
  }

  async function copyEditorJsonToClipboard() {
    const payload = buildEditorJsonPayload(form, {
      mode: editorMode,
      gameId: editingGameId || resolvedId,
      archiveFileName:
        archiveFile?.name ||
        (linkedDriveFileId ? `drive:${linkedDriveFileId}` : linkedDriveUrl ? `remote:${linkedDriveUrl}` : ""),
      includeExportedAt: true
    });
    const serialized = JSON.stringify(payload, null, 2);
    const copied = await copyTextToClipboard(serialized);
    if (!copied) {
      setNoticeState("Nao foi possivel copiar automaticamente. Abra o JSON em tela e use Ctrl+C.", true);
      return;
    }
    if (editorMode === "new" && typeof window !== "undefined") {
      const draftPayload: EditorDraft = {
        form,
        genreInput: String(genreInput || ""),
        galleryInput: String(galleryInput || ""),
        linkedDriveFileId: String(linkedDriveFileId || ""),
        linkedDriveUrl: String(linkedDriveUrl || ""),
        updatedAt: new Date().toISOString()
      };
      window.localStorage.setItem(EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
      setDraftUpdatedAt(draftPayload.updatedAt);
    }
    setNoticeState("JSON copiado para a area de transferencia.", false);
  }

  function openJsonImportDialog() {
    setJsonImportInput("");
    setIsJsonImportOpen(true);
  }

  function closeJsonImportDialog() {
    setIsJsonImportOpen(false);
    setJsonImportInput("");
  }

  function applyJsonImport() {
    const raw = String(jsonImportInput || "").trim();
    if (!raw) {
      setNoticeState("Cole um JSON valido para importar.", true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const importedForm = normalizeImportedFormPayload(parsed, form, editorMode);
      setForm(importedForm);
      if (!importedForm.id && editorMode === "new") {
        updateField("id", normalizeId(importedForm.name));
      }
      if (editorMode === "new" && typeof window !== "undefined") {
        const payload: EditorDraft = {
          form: importedForm,
          genreInput: "",
          galleryInput: "",
          linkedDriveFileId: String(linkedDriveFileId || ""),
          linkedDriveUrl: String(linkedDriveUrl || ""),
          updatedAt: new Date().toISOString()
        };
        window.localStorage.setItem(EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(payload));
        setDraftUpdatedAt(payload.updatedAt);
      }
      setGenreInput("");
      setGalleryInput("");
      closeJsonImportDialog();
      setNoticeState("JSON importado com sucesso. Revise e clique em Publicar jogo.", false);
    } catch (error) {
      setNoticeState(error instanceof Error ? error.message : "Falha ao importar JSON.", true);
    }
  }

  function setLayoutMode(mode: "simplified" | "complete") {
    setEditorLayoutMode(mode);
    if (mode === "complete") {
      setShowAdvancedInSimplified(true);
    } else {
      setShowAdvancedInSimplified(true);
    }
  }

  function toggleAdvancedFields() {
    setShowAdvancedInSimplified((prev) => !prev);
  }

  function reorderGalleryItems(fromIndex: number, toIndex: number) {
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return;
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= galleryItems.length || toIndex >= galleryItems.length) return;

    const next = [...galleryItems];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    setGallery(next);
  }

  function moveGalleryItem(index: number, delta: -1 | 1) {
    reorderGalleryItems(index, index + delta);
  }

  function onGalleryDragStart(event: DragEvent<HTMLElement>, index: number) {
    setDraggedGalleryIndex(index);
    setGalleryDropIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function onGalleryDragOver(event: DragEvent<HTMLElement>, index: number) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (galleryDropIndex !== index) {
      setGalleryDropIndex(index);
    }
  }

  function onGalleryDrop(event: DragEvent<HTMLElement>, index: number) {
    event.preventDefault();
    const transferred = Number(event.dataTransfer.getData("text/plain"));
    const fromIndex = Number.isFinite(transferred) ? transferred : draggedGalleryIndex;
    if (fromIndex === null) {
      setDraggedGalleryIndex(null);
      setGalleryDropIndex(null);
      return;
    }
    reorderGalleryItems(fromIndex, index);
    setDraggedGalleryIndex(null);
    setGalleryDropIndex(null);
  }

  function onGalleryDragEnd() {
    setDraggedGalleryIndex(null);
    setGalleryDropIndex(null);
  }

  function resetCatalogDragState() {
    setDraggedCatalogGameId("");
    setCatalogDropTargetGameId("");
    setCatalogDropPlacement("after");
    catalogDragSnapshotRef.current = null;
    catalogLastDropSignatureRef.current = "";
  }

  function cancelCatalogDragAndRevert() {
    if (Array.isArray(catalogDragSnapshotRef.current)) {
      setGames(catalogDragSnapshotRef.current);
    }
    resetCatalogDragState();
  }

  function resolveCatalogDropFromCard(
    event: DragEvent<HTMLElement>,
    overGameId: string,
    draggedId: string,
    sourceGames: LauncherGame[]
  ): { dropIndex: number; dropPlacement: "before" | "after" } | null {
    if (!draggedId) {
      return null;
    }

    const draggedIndex = sourceGames.findIndex((game) => game.id === draggedId);
    const overIndex = sourceGames.findIndex((game) => game.id === overGameId);
    if (draggedIndex < 0 || overIndex < 0) {
      return null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const horizontalOffset = Math.abs(event.clientX - (rect.left + rect.width / 2));
    const verticalOffset = Math.abs(event.clientY - (rect.top + rect.height / 2));
    const prioritizeHorizontal = horizontalOffset > verticalOffset;
    const axisSize = prioritizeHorizontal ? rect.width : rect.height;
    const axisOffset = prioritizeHorizontal ? event.clientX - rect.left : event.clientY - rect.top;
    const ratio = axisSize > 0 ? axisOffset / axisSize : 0.5;

    let dropPlacement: "before" | "after";
    if (ratio <= 0.43) {
      dropPlacement = "before";
    } else if (ratio >= 0.57) {
      dropPlacement = "after";
    } else {
      // Dead zone in the center avoids rapid before/after flips while cursor is near midpoint.
      dropPlacement = overIndex <= draggedIndex ? "before" : "after";
    }

    const rawIndex = overIndex + (dropPlacement === "after" ? 1 : 0);
    return {
      dropIndex: Math.max(0, Math.min(rawIndex, sourceGames.length)),
      dropPlacement
    };
  }

  async function saveCatalogOrder(nextOrderedGames: LauncherGame[], previousGamesFallback?: LauncherGame[]) {
    if (!isCatalogReorderEnabled) {
      return;
    }

    const orderedIds = nextOrderedGames
      .map((game) => String(game?.id || "").trim().toLowerCase())
      .filter(Boolean);
    if (orderedIds.length === 0) {
      return;
    }

    const previousGames = Array.isArray(previousGamesFallback) ? previousGamesFallback : games;
    const optimisticGames = withSequentialSortOrder(nextOrderedGames);
    setGames(optimisticGames);
    setIsSavingCatalogOrder(true);

    try {
      const response = await fetchApiWithTimeout(
        "/api/launcher-games",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderedIds
          })
        },
        45000
      );
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        games?: LauncherGame[];
        updated?: number;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Falha ao atualizar ordem (${response.status}).`);
      }

      const resolvedGames = Array.isArray(json.games) ? json.games : optimisticGames;
      setGames(resolvedGames);
      if (Number(json.updated || 0) > 0) {
        setNoticeState("Ordem do launcher atualizada com sucesso.", false);
      }
    } catch (error) {
      setGames(previousGames);
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido ao salvar a nova ordem. Tente novamente.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao salvar ordem dos jogos.", true);
      }
    } finally {
      setIsSavingCatalogOrder(false);
    }
  }

  function onCatalogDragStart(event: DragEvent<HTMLElement>, gameId: string) {
    if (!isCatalogReorderEnabled) {
      event.preventDefault();
      return;
    }

    const normalizedGameId = String(gameId || "").trim();
    if (!normalizedGameId) {
      event.preventDefault();
      return;
    }

    const startIndex = games.findIndex((game) => game.id === normalizedGameId);
    if (startIndex < 0) {
      event.preventDefault();
      return;
    }

    catalogDragSnapshotRef.current = games;
    catalogLastDropSignatureRef.current = "";
    setDraggedCatalogGameId(normalizedGameId);
    setCatalogDropTargetGameId(normalizedGameId);
    setCatalogDropPlacement("after");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", normalizedGameId);
  }

  function onCatalogCardDragOver(event: DragEvent<HTMLElement>, overGameId: string) {
    if (!isCatalogReorderEnabled || !draggedCatalogGameId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const draggedId = String(event.dataTransfer.getData("text/plain") || draggedCatalogGameId).trim() || draggedCatalogGameId;
    const dropResult = resolveCatalogDropFromCard(event, overGameId, draggedId, games);
    if (!draggedId || !dropResult) {
      return;
    }

    const nextSignature = `${draggedId}:${overGameId}:${dropResult.dropPlacement}:${dropResult.dropIndex}`;
    if (catalogLastDropSignatureRef.current === nextSignature) {
      return;
    }
    catalogLastDropSignatureRef.current = nextSignature;

    const nextOrder = reorderGamesByDropIndex(games, draggedId, dropResult.dropIndex);
    if (!hasSameGameOrder(games, nextOrder)) {
      setGames(nextOrder);
    }
    setCatalogDropTargetGameId(overGameId);
    setCatalogDropPlacement(dropResult.dropPlacement);
  }

  function onCatalogCardDrop(event: DragEvent<HTMLElement>, overGameId: string) {
    if (!isCatalogReorderEnabled || !draggedCatalogGameId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const snapshot = Array.isArray(catalogDragSnapshotRef.current) ? catalogDragSnapshotRef.current : games;
    const draggedId = String(event.dataTransfer.getData("text/plain") || draggedCatalogGameId).trim() || draggedCatalogGameId;
    const dropResult = resolveCatalogDropFromCard(event, overGameId, draggedId, games);
    const nextRawOrder = !dropResult ? games : reorderGamesByDropIndex(games, draggedId, dropResult.dropIndex);
    const nextOrder = withSequentialSortOrder(nextRawOrder);
    const hasChanged = !hasSameGameOrder(snapshot, nextOrder);
    setGames(nextOrder);
    resetCatalogDragState();
    if (!draggedId || !hasChanged) {
      return;
    }
    void saveCatalogOrder(nextOrder, snapshot);
  }

  function onCatalogGridDragOver(event: DragEvent<HTMLElement>) {
    if (!isCatalogReorderEnabled || !draggedCatalogGameId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const draggedId = String(event.dataTransfer.getData("text/plain") || draggedCatalogGameId).trim() || draggedCatalogGameId;
    const target = event.target;
    if (target instanceof Element && target.closest(".game-card-shell")) {
      return;
    }
    if (!draggedId) {
      return;
    }
    const dropAtEndIndex = games.length;
    const nextSignature = `${draggedId}:__end:after:${dropAtEndIndex}`;
    if (catalogLastDropSignatureRef.current === nextSignature) {
      return;
    }
    catalogLastDropSignatureRef.current = nextSignature;
    const nextOrder = reorderGamesByDropIndex(games, draggedId, dropAtEndIndex);
    if (!hasSameGameOrder(games, nextOrder)) {
      setGames(nextOrder);
    }
    setCatalogDropTargetGameId("");
    setCatalogDropPlacement("after");
  }

  function onCatalogGridDrop(event: DragEvent<HTMLElement>) {
    if (!isCatalogReorderEnabled || !draggedCatalogGameId) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest(".game-card-shell")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const snapshot = Array.isArray(catalogDragSnapshotRef.current) ? catalogDragSnapshotRef.current : games;
    const draggedId = String(event.dataTransfer.getData("text/plain") || draggedCatalogGameId).trim() || draggedCatalogGameId;
    const dropAtEndIndex = games.length;
    const nextRawOrder = draggedId ? reorderGamesByDropIndex(games, draggedId, dropAtEndIndex) : games;
    const nextOrder = withSequentialSortOrder(nextRawOrder);
    const hasChanged = !hasSameGameOrder(snapshot, nextOrder);
    setGames(nextOrder);
    resetCatalogDragState();
    if (!draggedId) {
      return;
    }
    if (!hasChanged) {
      return;
    }
    void saveCatalogOrder(nextOrder, snapshot);
  }

  function onCatalogDragEnd() {
    if (!catalogDragSnapshotRef.current) {
      resetCatalogDragState();
      return;
    }
    cancelCatalogDragAndRevert();
  }

  function setGenres(items: string[]) {
    updateField("genres", uniqueList(items).join("\n"));
  }

  function setGallery(items: string[]) {
    updateField("gallery", uniqueList(items.map(normalizeGalleryMediaUrl)).join("\n"));
  }

  function addGenresFromInput() {
    const newTags = uniqueList(parseListText(genreInput));
    if (newTags.length === 0) return;
    setGenres([...genreItems, ...newTags]);
    setGenreInput("");
  }

  function onGenreInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      addGenresFromInput();
    }
  }

  function removeGenre(tag: string) {
    setGenres(genreItems.filter((item) => item !== tag));
  }

  function addGalleryFromInput() {
    const next = uniqueList(parseListText(galleryInput).map(normalizeGalleryMediaUrl));
    if (next.length === 0) return;
    setGallery([...galleryItems, ...next]);
    setGalleryInput("");
  }

  function onGalleryInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addGalleryFromInput();
    }
  }

  function removeGalleryItem(value: string) {
    setGallery(galleryItems.filter((item) => item !== value));
  }

  function applyGalleryImageAsCover(value: string) {
    const url = normalizeUrlInput(value);
    if (!url) return;
    updateField("cardImageUrl", url);
    if (!form.imageUrl.trim()) updateField("imageUrl", url);
    setNoticeState("Imagem aplicada como capa do card.", false);
  }

  async function onGalleryUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsUploadingGallery(true);
    try {
      const payload = new FormData();
      files.forEach((file) => payload.append("images", file));

      const response = await fetchApiWithTimeout(
        "/api/upload-gallery-image",
        {
          method: "POST",
          body: payload
        },
        45000
      );

      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        urls?: string[];
        message?: string;
        error?: string;
      } | null;

      if (!response.ok || !json?.ok || !Array.isArray(json.urls)) {
        throw new Error(json?.message || json?.error || `Falha ao enviar imagens (${response.status}).`);
      }

      const uploaded = uniqueList(json.urls.map(normalizeUrlInput));
      if (uploaded.length > 0) {
        setGallery([...galleryItems, ...uploaded]);
        if (!form.cardImageUrl.trim()) updateField("cardImageUrl", uploaded[0]);
        if (!form.imageUrl.trim()) updateField("imageUrl", uploaded[0]);
      }
      setNoticeState(`${uploaded.length} imagem(ns) adicionada(s) na galeria.`, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido no upload das imagens. Tente novamente com menos arquivos.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao enviar imagens.", true);
      }
    } finally {
      setIsUploadingGallery(false);
      event.target.value = "";
    }
  }

  function resetEditor() {
    setForm(INITIAL_FORM);
    setArchiveFile(null);
    setDriveLinkStageInput("");
    setLinkedDriveFileId("");
    setLinkedDriveUrl("");
    setAllowMetadataWithoutDownloadSource(false);
    setIsArchiveDragActive(false);
    archiveDragDepthRef.current = 0;
    setEditingGameId("");
    setEditorMode("new");
    setGenreInput("");
    setGalleryInput("");
    if (editorLayoutMode === "simplified") setShowAdvancedInSimplified(true);
    setBaseSnapshot(createFormSnapshot(INITIAL_FORM, { mode: "new", archiveKey: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (galleryUploadInputRef.current) galleryUploadInputRef.current.value = "";
  }

  async function fetchApiWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        credentials: "include",
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function loadViewer(options: { showLoading?: boolean } = {}) {
    const showLoading = options.showLoading !== false;
    if (showLoading) {
      setViewerLoading(true);
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/me", { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(`Falha ao validar sessao (${response.status}).`);
      const json = (await response.json()) as ViewerState;
      setViewer({
        authenticated: Boolean(json.authenticated),
        isAdmin: Boolean(json.isAdmin),
        role: normalizeStaffRole(String(json.role || "")),
        permissions: {
          manageStaff: Boolean(json.permissions?.manageStaff),
          publishGame: Boolean(json.permissions?.publishGame),
          editGame: Boolean(json.permissions?.editGame),
          removeGame: Boolean(json.permissions?.removeGame),
          manageMaintenance: Boolean(json.permissions?.manageMaintenance)
        },
        steamLoginReady: Boolean(json.steamLoginReady),
        steamLoginReason: String(json.steamLoginReason || ""),
        adminError: String(json.adminError || ""),
        adminStorage: String(json.adminStorage || ""),
        user: json.user || null
      });
      if (json.adminError) setNoticeState(String(json.adminError), true);
    } catch (error) {
      setViewer(EMPTY_VIEWER);
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("A validacao de sessao demorou demais (/api/me). Tente novamente em alguns segundos.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao validar sessao.", true);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (showLoading) {
        setViewerLoading(false);
      }
    }
  }

  async function loadGames() {
    setGamesLoading(true);
    try {
      const response = await fetchApiWithTimeout("/api/launcher-games?limit=500", {}, 15000);
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        games?: LauncherGame[];
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Falha ao carregar jogos (${response.status}).`);
      }
      setGames(Array.isArray(json.games) ? json.games : []);
    } catch (error) {
      setGames([]);
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido ao carregar jogos. Tente recarregar em alguns segundos.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao carregar catalogo.", true);
      }
    } finally {
      setGamesLoading(false);
    }
  }

  async function loadAdmins() {
    setAdminsLoading(true);
    try {
      const response = await fetchApiWithTimeout("/api/admins", {}, 15000);
      if (!response.ok) throw new Error(`Falha ao carregar staffs (${response.status}).`);
      const json = (await response.json()) as { admins?: AdminRecord[] };
      setAdmins(Array.isArray(json.admins) ? json.admins : []);
    } catch (error) {
      setAdmins([]);
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido ao carregar staffs. Tente recarregar em alguns segundos.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao carregar staffs.", true);
      }
    } finally {
      setAdminsLoading(false);
    }
  }

  async function loadMaintenanceFlag() {
    setMaintenanceLoading(true);
    try {
      const response = await fetchApiWithTimeout("/api/runtime-flags/maintenance", {}, 12000);
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        flag?: unknown;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Falha ao carregar manutencao (${response.status}).`);
      }
      const normalizedFlag = normalizeMaintenanceFlag(json.flag);
      setMaintenanceFlag(normalizedFlag);
      setMaintenanceTitleDraft(normalizedFlag.title);
      setMaintenanceMessageDraft(normalizedFlag.message);
    } catch (error) {
      setMaintenanceFlag(DEFAULT_MAINTENANCE_FLAG);
      setMaintenanceTitleDraft(DEFAULT_MAINTENANCE_FLAG.title);
      setMaintenanceMessageDraft(DEFAULT_MAINTENANCE_FLAG.message);
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido ao carregar manutencao. Tente novamente.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao carregar manutencao.", true);
      }
    } finally {
      setMaintenanceLoading(false);
    }
  }

  async function loadDashboardBootstrap() {
    setGamesLoading(true);
    setAdminsLoading(true);
    setMaintenanceLoading(true);
    try {
      const response = await fetchApiWithTimeout("/api/dashboard/bootstrap", {}, 18000);
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        games?: LauncherGame[];
        admins?: AdminRecord[];
        maintenance?: unknown;
        warnings?: string[];
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Falha ao carregar dashboard (${response.status}).`);
      }

      setGames(Array.isArray(json.games) ? json.games : []);
      setAdmins(Array.isArray(json.admins) ? json.admins : []);
      const normalizedFlag = normalizeMaintenanceFlag(json.maintenance);
      setMaintenanceFlag(normalizedFlag);
      setMaintenanceTitleDraft(normalizedFlag.title);
      setMaintenanceMessageDraft(normalizedFlag.message);

      const warnings = Array.isArray(json.warnings) ? json.warnings.filter(Boolean) : [];
      if (warnings.length > 0) {
        setNoticeState(warnings[0], true);
      }
    } catch (error) {
      setGames([]);
      setAdmins([]);
      setMaintenanceFlag(DEFAULT_MAINTENANCE_FLAG);
      setMaintenanceTitleDraft(DEFAULT_MAINTENANCE_FLAG.title);
      setMaintenanceMessageDraft(DEFAULT_MAINTENANCE_FLAG.message);
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido ao carregar dashboard. Tente novamente.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao carregar dashboard.", true);
      }
    } finally {
      setGamesLoading(false);
      setAdminsLoading(false);
      setMaintenanceLoading(false);
    }
  }

  async function saveMaintenanceFlag(next: {
    enabled?: boolean;
    title?: string;
    message?: string;
    data?: Record<string, unknown>;
  }, successNotice = "") {
    if (!canManageMaintenance) {
      setNoticeState("Seu cargo so pode visualizar o status de manutencao.", true);
      return;
    }
    setIsSavingMaintenance(true);
    try {
      const payload = {
        enabled: typeof next.enabled === "boolean" ? next.enabled : maintenanceFlag.enabled,
        title: String(next.title ?? maintenanceTitleDraft).trim() || DEFAULT_MAINTENANCE_FLAG.title,
        message: String(next.message ?? maintenanceMessageDraft).trim() || DEFAULT_MAINTENANCE_FLAG.message,
        data:
          next.data && typeof next.data === "object" && !Array.isArray(next.data)
            ? next.data
            : maintenanceFlag.data || {}
      };

      const response = await fetch("/api/runtime-flags/maintenance", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        flag?: unknown;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Falha ao salvar manutencao (${response.status}).`);
      }

      const normalizedFlag = normalizeMaintenanceFlag(json.flag);
      setMaintenanceFlag(normalizedFlag);
      setMaintenanceTitleDraft(normalizedFlag.title);
      setMaintenanceMessageDraft(normalizedFlag.message);
      if (successNotice) {
        setNoticeState(successNotice, false);
      } else {
        setNoticeState(
          normalizedFlag.enabled
            ? "Modo manutencao ativado com sucesso."
            : "Modo manutencao desativado com sucesso.",
          false
        );
      }
    } catch (error) {
      setNoticeState(error instanceof Error ? error.message : "Falha ao salvar manutencao.", true);
    } finally {
      setIsSavingMaintenance(false);
    }
  }

  async function refreshDashboardData() {
    await loadDashboardBootstrap();
    setNoticeState("Dashboard atualizado.", false);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const message = authQueryMessage(params);
    if (message) {
      setAuthMsg(message);
      const clean = new URL(window.location.href);
      clean.search = "";
      window.history.replaceState({}, "", clean.toString());
    }
  }, []);

  useEffect(() => {
    void loadViewer({ showLoading: false });
  }, []);

  useEffect(() => {
    if (!notice.msg) {
      clearNoticeHideTimer();
      return;
    }
    if (!noticeHoveredRef.current) {
      scheduleNoticeHideTimer(NOTICE_AUTO_HIDE_MS);
    }
  }, [notice.msg]);

  useEffect(() => {
    return () => {
      clearNoticeHideTimer();
    };
  }, []);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (!viewer.authenticated || !viewer.isAdmin) {
      setIsUserMenuOpen(false);
      setIsAddStaffModalOpen(false);
    }
  }, [viewer.authenticated, viewer.isAdmin]);

  useEffect(() => {
    if (!viewer.authenticated || !viewer.isAdmin) return;
    void loadDashboardBootstrap();
  }, [viewer.authenticated, viewer.isAdmin]);

  useEffect(() => {
    if (!catalogDragActive) return;
    if (dashboardSection !== "jogos" || view !== "catalog" || !isCatalogReorderEnabled) {
      cancelCatalogDragAndRevert();
    }
  }, [catalogDragActive, dashboardSection, view, isCatalogReorderEnabled]);

  useEffect(() => {
    if (!catalogDragActive) return;
    const draggedStillVisible = games.some((game) => game.id === draggedCatalogGameId);
    if (!draggedStillVisible) {
      cancelCatalogDragAndRevert();
    }
  }, [catalogDragActive, games, draggedCatalogGameId]);

  useEffect(() => {
    const normalizedInput = normalizeUrlInput(form.steamUrl);
    const steamIdFromUrl = extractSteamAppIdFromInput(normalizedInput);
    const normalizedSteamId = steamIdFromUrl || "";
    const normalizedSteamUrl = steamIdFromUrl
      ? buildSteamStoreUrl(steamIdFromUrl)
      : normalizedInput;

    if (form.steamAppId === normalizedSteamId && form.steamUrl === normalizedSteamUrl) {
      return;
    }

    setForm((prev) => {
      if (prev.steamAppId === normalizedSteamId && prev.steamUrl === normalizedSteamUrl) {
        return prev;
      }
      return {
        ...prev,
        steamAppId: normalizedSteamId,
        steamUrl: normalizedSteamUrl
      };
    });
  }, [form.steamAppId, form.steamUrl]);

  useEffect(() => {
    const draft = readEditorDraft();
    if (!draft) return;
    setDraftUpdatedAt(String(draft.updatedAt || ""));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(EDITOR_LAYOUT_STORAGE_KEY);
    if (stored === "simplified" || stored === "complete") {
      setEditorLayoutMode(stored);
      if (stored === "complete") {
        setShowAdvancedInSimplified(true);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, editorLayoutMode);
  }, [editorLayoutMode]);

  useEffect(() => {
    if (view !== "editor" || editorMode !== "new") return;
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      const payload: EditorDraft = {
        form,
        genreInput: String(genreInput || ""),
        galleryInput: String(galleryInput || ""),
        linkedDriveFileId: String(linkedDriveFileId || ""),
        linkedDriveUrl: String(linkedDriveUrl || ""),
        updatedAt: new Date().toISOString()
      };
      window.localStorage.setItem(EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      setDraftUpdatedAt(payload.updatedAt);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [view, editorMode, form, genreInput, galleryInput, linkedDriveFileId, linkedDriveUrl]);

  useEffect(() => {
    if (view !== "editor" || !isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [view, isDirty]);

  useEffect(() => {
    if (view !== "editor") return;
    const onHotkey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (isSaving || isUploadingGallery) return;
      formRef.current?.requestSubmit();
    };
    window.addEventListener("keydown", onHotkey);
    return () => window.removeEventListener("keydown", onHotkey);
  }, [view, isSaving, isUploadingGallery]);

  function startLogin() {
    try {
      const directUrl = buildDirectSteamOpenIdUrl(window.location.origin);
      window.location.assign(directUrl);
    } catch (_error) {
      window.location.assign(`/api/auth/steam?ts=${Date.now()}`);
    }
  }

  async function logout() {
    if (view === "editor" && !confirmDiscardChanges()) {
      return;
    }
    setIsUserMenuOpen(false);
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } finally {
      resetEditor();
      setView("catalog");
      setDashboardSection("inicio");
      await loadViewer();
    }
  }

  function openNewGame() {
    if (!canPublishGames) {
      setNoticeState("Seu cargo nao pode adicionar jogos.", true);
      return;
    }
    if (view === "editor" && !confirmDiscardChanges()) return;
    resetEditor();
    setView("editor");
    setDashboardSection("jogos");
    setEditorMode("new");
    setAllowMetadataWithoutDownloadSource(false);
    setIsArchiveDragActive(false);
    archiveDragDepthRef.current = 0;
    if (editorLayoutMode === "simplified") setShowAdvancedInSimplified(true);
    setNoticeState("", false);
  }

  function openEditor(game: LauncherGame) {
    if (!canEditGames) {
      setNoticeState("Seu cargo nao pode editar jogos.", true);
      return;
    }
    if (view === "editor" && !confirmDiscardChanges()) return;
    const nextForm = gameToForm(game);
    setView("editor");
    setDashboardSection("jogos");
    setEditorMode("edit");
    setEditingGameId(game.id);
    setArchiveFile(null);
    setDriveLinkStageInput("");
    setLinkedDriveFileId("");
    setLinkedDriveUrl("");
    setAllowMetadataWithoutDownloadSource(false);
    setIsArchiveDragActive(false);
    archiveDragDepthRef.current = 0;
    setGenreInput("");
    setGalleryInput("");
    if (editorLayoutMode === "simplified") setShowAdvancedInSimplified(true);
    setForm(nextForm);
    setBaseSnapshot(createFormSnapshot(nextForm, { mode: "edit", gameId: game.id, archiveKey: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (galleryUploadInputRef.current) galleryUploadInputRef.current.value = "";
    setNoticeState("", false);
  }

  function applyArchiveFile(file: File | null) {
    if (!file) {
      setArchiveFile(null);
      return;
    }

    if (!isSupportedArchiveFileName(file.name)) {
      setNoticeState("Envie um arquivo .rar ou .zip valido.", true);
      return;
    }

    setArchiveFile(file);
    setAllowMetadataWithoutDownloadSource(false);
    setLinkedDriveFileId("");
    setLinkedDriveUrl("");
    updateField("archiveType", file.name.toLowerCase().endsWith(".zip") ? "zip" : "rar");
    if (!form.name.trim() && editorMode === "new") updateField("name", filenameToGameName(file.name));
    if (!form.sizeBytes.trim()) updateField("sizeBytes", String(file.size || ""));
    if (!form.sizeLabel.trim()) updateField("sizeLabel", formatBytesLabel(String(file.size || "")));
    setIsArchiveDragActive(false);
    archiveDragDepthRef.current = 0;
  }

  function onArchiveDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    archiveDragDepthRef.current += 1;
    setIsArchiveDragActive(true);
  }

  function onArchiveDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isArchiveDragActive) {
      setIsArchiveDragActive(true);
    }
  }

  function onArchiveDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    archiveDragDepthRef.current = Math.max(0, archiveDragDepthRef.current - 1);
    if (archiveDragDepthRef.current === 0) {
      setIsArchiveDragActive(false);
    }
  }

  function onArchiveDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    archiveDragDepthRef.current = 0;
    setIsArchiveDragActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    const file = files.find((item) => isSupportedArchiveFileName(item.name)) || null;
    if (!file) {
      setNoticeState("Arraste um arquivo .rar ou .zip valido para continuar.", true);
      return;
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    applyArchiveFile(file);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    applyArchiveFile(file);
    event.target.value = "";
  }

  function continueWithRemoteLink() {
    const normalizedLink = normalizeUrlInput(driveLinkStageInput);
    if (!normalizedLink) {
      setNoticeState("Cole um link de arquivo remoto para continuar (Drive/Dropbox).", true);
      return;
    }
    if (isGoogleDriveFolderLink(normalizedLink)) {
      setNoticeState("Link de pasta do Google Drive detectado. Cole o link do arquivo .rar/.zip.", true);
      return;
    }
    if (isDropboxFolderLink(normalizedLink)) {
      setNoticeState("Link de pasta do Dropbox detectado. Cole o link direto do arquivo .rar/.zip.", true);
      return;
    }

    const resolvedDownload = resolveDownloadUrlInput(normalizedLink);
    const directDownloadLink = resolvedDownload.url;
    if (!directDownloadLink || !parseHttpUrlInput(directDownloadLink)) {
      setNoticeState("Link invalido. Use uma URL http/https de arquivo (Drive/Dropbox).", true);
      return;
    }
    const driveFileId = resolvedDownload.driveFileId;

    setArchiveFile(null);
    setAllowMetadataWithoutDownloadSource(false);
    setLinkedDriveFileId(driveFileId);
    setLinkedDriveUrl(directDownloadLink);
    setDriveLinkStageInput(directDownloadLink);
    setIsArchiveDragActive(false);
    archiveDragDepthRef.current = 0;
    const mergedDownloadUrls = uniqueList([
      directDownloadLink,
      ...parseListText(form.downloadUrls).map(normalizeDownloadUrlInput)
    ]);
    updateField("downloadUrls", mergedDownloadUrls.join("\n"));
    const providerLabel = driveFileId ? "Google Drive" : isDropboxLink(normalizedLink) ? "Dropbox" : "fonte remota";
    setNoticeState(`Link de ${providerLabel} aplicado. Agora finalize os metadados e publique.`, false);
  }

  function continueWithoutDownloadSource() {
    setAllowMetadataWithoutDownloadSource(true);
    setForm((prev) => ({
      ...prev,
      comingSoon: true
    }));
    setNoticeState("Modo Coming Soon ativado. Voce pode salvar sem link agora e publicar o download depois.", false);
  }

  function onComingSoonToggle(nextValue: boolean) {
    if (nextValue) {
      updateField("comingSoon", true);
      return;
    }
    if (isStaffViewer && !hasAnyDownloadSource) {
      updateField("comingSoon", true);
      setNoticeState("Staff nao pode desativar coming_soon sem um link de download valido.", true);
      return;
    }
    updateField("comingSoon", false);
  }

  function openPrimaryDownloadModal() {
    if (!canEditGames || editorMode !== "edit" || !editingGameId) {
      return;
    }
    setPrimaryDownloadDraft(primaryDownloadLink);
    setIsPrimaryDownloadModalOpen(true);
  }

  function closePrimaryDownloadModal() {
    if (isSavingPrimaryDownload) {
      return;
    }
    setIsPrimaryDownloadModalOpen(false);
  }

  function normalizePrimaryDownloadLinkInput(rawValue: string): { url: string; driveFileId: string } | null {
    const normalizedInput = normalizeUrlInput(rawValue);
    if (!normalizedInput) {
      setNoticeState("Informe um link de download principal valido.", true);
      return null;
    }
    if (isGoogleDriveFolderLink(normalizedInput)) {
      setNoticeState("Link de pasta do Google Drive detectado. Use o link direto do arquivo.", true);
      return null;
    }
    if (isDropboxFolderLink(normalizedInput)) {
      setNoticeState("Link de pasta do Dropbox detectado. Use o link direto do arquivo.", true);
      return null;
    }

    const resolvedDownload = resolveDownloadUrlInput(normalizedInput);
    const url = resolvedDownload.url;

    if (!url || !parseHttpUrlInput(url)) {
      setNoticeState("Link invalido. Use uma URL http/https de arquivo.", true);
      return null;
    }
    return {
      url,
      driveFileId: resolvedDownload.driveFileId
    };
  }

  async function savePrimaryDownloadLink() {
    if (!canEditGames) {
      setNoticeState("Seu cargo nao pode editar jogos.", true);
      return;
    }
    if (editorMode !== "edit" || !editingGameId) {
      setNoticeState("Abra um jogo existente para alterar o link principal.", true);
      return;
    }

    const normalized = normalizePrimaryDownloadLinkInput(primaryDownloadDraft);
    if (!normalized) {
      return;
    }

    const currentDownloadUrls = uniqueList([
      ...parseListText(form.downloadUrls).map(normalizeDownloadUrlInput),
      ...(Array.isArray(editingGame?.download_urls) ? editingGame.download_urls : []).map((entry) =>
        normalizeDownloadUrlInput(String(entry || ""))
      ),
      normalizeDownloadUrlInput(editingGame?.download_url || "")
    ]).filter(Boolean);
    const nextDownloadUrls = uniqueList([normalized.url, ...currentDownloadUrls.filter((entry) => entry !== normalized.url)]);
    if (nextDownloadUrls.length === 0) {
      setNoticeState("Nao foi possivel montar a lista de download.", true);
      return;
    }

    setIsSavingPrimaryDownload(true);
    try {
      const payload = new FormData();
      payload.append("id", editingGameId);
      payload.append("name", String(form.name || editingGame?.name || editingGameId).trim() || editingGameId);
      payload.append("downloadUrls", JSON.stringify(nextDownloadUrls));
      payload.append("driveLink", normalized.url);
      if (normalized.driveFileId) {
        payload.append("driveFileId", normalized.driveFileId);
      }

      const response = await fetchApiWithTimeout(
        "/api/publish-game",
        {
          method: "POST",
          body: payload
        },
        45000
      );
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        game?: LauncherGame;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Falha ao atualizar link principal (${response.status}).`);
      }

      const savedGame = json?.game;
      if (savedGame && savedGame.id) {
        setGames((prev) => prev.map((game) => (game.id === savedGame.id ? savedGame : game)));
      } else {
        await loadGames();
      }

      const nextFormState: FormState = {
        ...form,
        downloadUrls: nextDownloadUrls.join("\n")
      };
      setForm(nextFormState);
      if (!isDirty) {
        setBaseSnapshot(
          createFormSnapshot(nextFormState, {
            mode: editorMode,
            gameId: editingGameId,
            archiveKey: archiveDescriptor
          })
        );
      }
      setPrimaryDownloadDraft(normalized.url);
      setIsPrimaryDownloadModalOpen(false);
      setNoticeState("Link principal atualizado com sucesso.", false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido ao atualizar link principal. Tente novamente.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao atualizar link principal.", true);
      }
    } finally {
      setIsSavingPrimaryDownload(false);
    }
  }

  async function saveGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNoticeState("", false);
    const steamUrlValue = normalizeUrlInput(form.steamUrl);
    const steamIdFromUrl = extractSteamAppIdFromInput(steamUrlValue);
    const steamIdValue = steamIdFromUrl || form.steamAppId.trim();
    const derivedSteamUrl = steamIdFromUrl ? buildSteamStoreUrl(steamIdFromUrl) : steamUrlValue;
    const normalizedReleaseDate = normalizeReleaseDateInput(form.releaseDate);

    if (!canPublishGames) {
      setNoticeState("Acesso negado.", true);
      return;
    }
    if (editorMode === "edit" && !canEditGames) {
      setNoticeState("Seu cargo pode criar jogos, mas nao pode editar jogos existentes.", true);
      return;
    }
    if (!resolvedId || !form.name.trim()) {
      setNoticeState("Preencha nome/ID do jogo.", true);
      return;
    }
    if (form.releaseDate.trim() && !normalizedReleaseDate) {
      setNoticeState("release_date invalida. Informe uma data valida para converter em YYYY-MM-DD.", true);
      return;
    }
    if (!isSteamIdValid) {
      setNoticeState("Steam URL invalida. Use um link no formato /app/ID.", true);
      return;
    }
    const shouldForceComingSoon = editorMode === "new" && !hasAnyDownloadSource;
    const finalComingSoon = shouldForceComingSoon ? true : Boolean(form.comingSoon);
    if (isStaffViewer && !finalComingSoon && !hasAnyDownloadSource) {
      setNoticeState("Staff nao pode tirar coming_soon sem uma fonte de download valida.", true);
      return;
    }

    setIsSaving(true);
    try {
      if (normalizedReleaseDate && normalizedReleaseDate !== form.releaseDate.trim()) {
        setForm((prev) => ({
          ...prev,
          releaseDate: normalizedReleaseDate
        }));
      }
      if (finalComingSoon !== form.comingSoon) {
        setForm((prev) => ({
          ...prev,
          comingSoon: finalComingSoon
        }));
      }
      const payload = new FormData();
      payload.append("id", resolvedId);
      payload.append("name", form.name.trim());
      payload.append("section", form.section.trim());
      payload.append("description", form.description.trim());
      payload.append("longDescription", form.longDescription.trim());
      payload.append("archiveType", form.archiveType);
      payload.append("archivePassword", form.archivePassword.trim());
      payload.append("installDirName", form.installDirName.trim());
      payload.append("launchExecutable", form.launchExecutable.trim());
      payload.append("imageUrl", normalizeMediaUrlForField("imageUrl", form.imageUrl));
      payload.append("cardImageUrl", normalizeMediaUrlForField("cardImageUrl", form.cardImageUrl));
      payload.append("bannerUrl", normalizeMediaUrlForField("bannerUrl", form.bannerUrl));
      payload.append("logoUrl", normalizeMediaUrlForField("logoUrl", form.logoUrl));
      payload.append("trailerUrl", normalizeMediaUrlForField("trailerUrl", form.trailerUrl));
      payload.append("developedBy", form.developedBy.trim());
      payload.append("publishedBy", form.publishedBy.trim());
      payload.append("releaseDate", normalizedReleaseDate);
      payload.append("steamAppId", steamIdValue);
      payload.append("steamUrl", derivedSteamUrl);
      payload.append("genres", JSON.stringify(uniqueList(parseListText(form.genres))));
      payload.append("gallery", JSON.stringify(uniqueList(parseListText(form.gallery).map(normalizeGalleryMediaUrl))));
      payload.append("downloadUrls", JSON.stringify(downloadUrlItems));
      payload.append("sizeBytes", form.sizeBytes.trim());
      payload.append("sizeLabel", form.sizeLabel.trim());
      payload.append("currentPrice", form.currentPrice.trim());
      payload.append("originalPrice", form.originalPrice.trim());
      payload.append("discountPercent", form.discountPercent.trim());
      payload.append("sortOrder", form.sortOrder.trim());
      payload.append("free", String(form.free));
      payload.append("exclusive", String(form.exclusive));
      payload.append("comingSoon", String(finalComingSoon));
      payload.append("enabled", String(form.enabled));
      if (linkedDriveFileId) payload.append("driveFileId", linkedDriveFileId);
      if (linkedDriveUrl) payload.append("driveLink", linkedDriveUrl);
      if (!linkedDriveFileId && editingGame?.google_drive_file_id) payload.append("driveFileId", editingGame.google_drive_file_id);
      if (archiveFile) payload.append("archive", archiveFile);

      const response = await fetchApiWithTimeout(
        "/api/publish-game",
        {
          method: "POST",
          body: payload
        },
        90000
      );
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        game?: { id?: string };
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Falha ao salvar (${response.status}).`);
      }

      const savedId = String(json.game?.id || resolvedId);
      setConfirm({ show: true, gameId: savedId, at: new Date().toISOString() });
      setNoticeState(`${savedId} salvo com sucesso.`, false);
      if (editorMode === "new") clearEditorDraft();
      setView("catalog");
      resetEditor();
      await loadGames();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setNoticeState("Tempo excedido ao publicar jogo. Verifique a fonte remota/Supabase e tente novamente.", true);
      } else {
        setNoticeState(error instanceof Error ? error.message : "Falha ao salvar jogo.", true);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function openAddStaffModal() {
    if (!canManageStaff) {
      setNoticeState("Seu cargo nao pode adicionar staffs.", true);
      return;
    }
    setStaffSteamId("");
    setStaffRole("staff");
    setIsAddStaffModalOpen(true);
  }

  function closeAddStaffModal() {
    if (isManagingStaff) {
      return;
    }
    setIsAddStaffModalOpen(false);
  }

  async function addStaff() {
    if (!canManageStaff) {
      setNoticeState("Seu cargo nao pode adicionar staffs.", true);
      return;
    }

    const rawInput = staffSteamId.trim();
    const steamId = extractSteamIdFromStaffInput(rawInput);
    if (!/^\d{17}$/.test(steamId)) {
      const looksLikeVanity = /steamcommunity\.com\/id\//i.test(rawInput);
      setNoticeState(
        looksLikeVanity
          ? "Nao foi possivel extrair o SteamID do link customizado. Use o link /profiles/ com ID numerico."
          : "SteamID invalido. Cole link /profiles/ ou SteamID de 17 digitos.",
        true
      );
      return;
    }
    setIsManagingStaff(true);
    try {
      const response = await fetch("/api/admins", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamId,
          staffRole
        })
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        admins?: AdminRecord[];
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || "Falha ao cadastrar staff.");
      }
      setAdmins(Array.isArray(json.admins) ? json.admins : admins);
      setStaffSteamId("");
      setStaffRole("staff");
      setIsAddStaffModalOpen(false);
      setNoticeState("Staff autorizado com sucesso.", false);
    } catch (error) {
      setNoticeState(error instanceof Error ? error.message : "Falha ao cadastrar staff.", true);
    } finally {
      setIsManagingStaff(false);
    }
  }

  function openStaffRoleEditor(admin: AdminRecord) {
    const steamId = String(admin?.steamId || "").trim();
    if (!steamId) {
      return;
    }
    setEditingStaffId(steamId);
    setEditingStaffRole(normalizeStaffRole(admin.staffRole));
  }

  function closeStaffRoleEditor() {
    if (isManagingStaff) {
      return;
    }
    setEditingStaffId("");
  }

  async function saveStaffRoleEdit() {
    if (!canManageStaff) {
      setNoticeState("Seu cargo nao pode alterar staffs.", true);
      return;
    }
    const steamId = editingStaffId.trim();
    if (!/^\d{17}$/.test(steamId)) {
      setNoticeState("SteamID invalido. Use 17 digitos.", true);
      return;
    }

    setIsManagingStaff(true);
    try {
      const response = await fetch(`/api/admins/${encodeURIComponent(steamId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffRole: editingStaffRole
        })
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        admins?: AdminRecord[];
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || "Falha ao atualizar cargo.");
      }

      setAdmins(Array.isArray(json.admins) ? json.admins : admins);
      setEditingStaffId("");
      setNoticeState("Cargo atualizado.", false);
    } catch (error) {
      setNoticeState(error instanceof Error ? error.message : "Falha ao atualizar cargo.", true);
    } finally {
      setIsManagingStaff(false);
    }
  }

  async function removeStaff(steamId: string) {
    if (!canManageStaff) {
      setNoticeState("Seu cargo nao pode remover staffs.", true);
      return;
    }
    setIsManagingStaff(true);
    try {
      const response = await fetch(`/api/admins/${encodeURIComponent(steamId)}`, {
        method: "DELETE",
        credentials: "include"
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        admins?: AdminRecord[];
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || "Falha ao remover staff.");
      }
      setAdmins(Array.isArray(json.admins) ? json.admins : []);
      setNoticeState("Staff removido.", false);
    } catch (error) {
      setNoticeState(error instanceof Error ? error.message : "Falha ao remover staff.", true);
    } finally {
      setIsManagingStaff(false);
    }
  }

  function requestGameRemoval(game: LauncherGame) {
    if (!canRemoveGames) {
      setNoticeState("Seu cargo nao pode remover jogos.", true);
      return;
    }
    setGameRemovalTarget(game);
  }

  async function confirmGameRemoval() {
    const target = gameRemovalTarget;
    if (!target) {
      return;
    }
    if (!canRemoveGames) {
      setNoticeState("Seu cargo nao pode remover jogos.", true);
      return;
    }

    setIsRemovingGame(true);
    try {
      const response = await fetch(`/api/launcher-games/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        credentials: "include"
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || "Falha ao remover jogo.");
      }

      setGameRemovalTarget(null);
      setNoticeState(`Jogo ${target.id} removido com sucesso.`, false);
      if (editingGameId === target.id) {
        resetEditor();
        setView("catalog");
      }
      await loadGames();
    } catch (error) {
      setNoticeState(error instanceof Error ? error.message : "Falha ao remover jogo.", true);
    } finally {
      setIsRemovingGame(false);
    }
  }

  function changeDashboardSection(next: "inicio" | "jogos" | "administracao") {
    if (next === dashboardSection) return;
    setIsUserMenuOpen(false);
    if (next !== "jogos" && view === "editor") {
      if (!confirmDiscardChanges()) return;
      resetEditor();
      setView("catalog");
    }
    setDashboardSection(next);
  }

  if (!viewer.authenticated) {
    return (
      <main className="admin-root">
        <section className="auth-shell">
          <article className="card auth-card">
            <p className="kicker">WPLAY STAFF PANEL</p>
            <h1>Login com Steam</h1>
            <p className="text-muted">Apenas SteamID autorizado acessa o painel.</p>
            {authMsg ? <p className="inline-alert is-warning">{authMsg}</p> : null}
            {viewerLoading ? <p className="text-muted">Carregando sessao...</p> : null}
            {!viewer.steamLoginReady && viewer.steamLoginReason ? (
              <p className="inline-alert is-warning">{viewer.steamLoginReason}</p>
            ) : null}
            <div className="auth-actions">
              <button className="button button-primary" onClick={startLogin}>
                Entrar com Steam
              </button>
              <button className="button button-secondary" onClick={() => void loadViewer()}>
                Tentar novamente
              </button>
            </div>
          </article>
        </section>
      </main>
    );
  }

  if (!viewer.isAdmin) {
    return (
      <main className="admin-root">
        <section className="auth-shell">
          <article className="card auth-card">
            <p className="kicker">WPLAY STAFF PANEL</p>
            <h1>Acesso negado</h1>
            <p className="text-muted">
              A Steam <code>{viewer.user?.steamId || "-"}</code> nao consta na tabela de staffs autorizados.
            </p>
            <button className="button button-ghost" onClick={logout}>
              Sair
            </button>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-root dashboard-mode">
      <div className="dashboard-shell">
        <aside className="dashboard-sidebar">
          <div className="dashboard-sidebar-head">
            <p className="kicker">WPLAY STAFF PANEL</p>
            <strong>Dashboard</strong>
            <span>{formatRoleLabel(viewerRole)}</span>
          </div>

          <nav className="dashboard-sidebar-nav" aria-label="Menu principal">
            <button
              className={`dashboard-nav-item ${dashboardSection === "inicio" ? "is-active" : ""}`}
              onClick={() => changeDashboardSection("inicio")}
              type="button"
            >
              Inicio
            </button>
            <button
              className={`dashboard-nav-item ${dashboardSection === "jogos" ? "is-active" : ""}`}
              onClick={() => changeDashboardSection("jogos")}
              type="button"
            >
              Jogos
            </button>
            <button
              className={`dashboard-nav-item ${dashboardSection === "administracao" ? "is-active" : ""}`}
              onClick={() => changeDashboardSection("administracao")}
              type="button"
            >
              Administracao
            </button>
          </nav>

        </aside>

        <section className="dashboard-content">
          <header className="topbar">
            <div className="topbar-spacer" />
            <div className="topbar-actions">
              <div className="user-menu-wrap" ref={userMenuRef}>
                <button
                  aria-expanded={isUserMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Abrir menu do usuario"
                  className={`user-avatar-btn ${isUserMenuOpen ? "is-open" : ""}`}
                  onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  type="button"
                >
                  {viewer.user?.avatar ? (
                    <img alt={viewerDisplayName} className="avatar" src={viewer.user.avatar} />
                  ) : (
                    <span className="user-avatar-fallback">{viewerAvatarInitial}</span>
                  )}
                </button>

                {isUserMenuOpen ? (
                  <section className="user-menu-panel" role="menu">
                    <div className="user-menu-head">
                      <div className="user-menu-name-row">
                        <strong>{viewerDisplayName}</strong>
                        <span className={`role-pill role-${viewerRole}`}>{formatRoleLabel(viewerRole)}</span>
                      </div>
                      <span className="user-menu-steamid">{viewerSteamId || "-"}</span>
                    </div>
                    <button className="button button-ghost user-menu-logout" onClick={logout} type="button">
                      Logout
                    </button>
                  </section>
                ) : null}
              </div>
            </div>
          </header>

          <input accept=".rar,.zip" className="hidden-input" onChange={onFileChange} ref={fileInputRef} type="file" />

          {dashboardSection === "inicio" ? (
            <section className="catalog-shell">
              <div className="admin-overview-grid">
                <article className="card overview-card">
                  <p className="kicker">CATALOGO</p>
                  <strong>{games.length}</strong>
                  <span>Total de jogos registrados.</span>
                </article>

                <article className="card overview-card">
                  <p className="kicker">PUBLICADOS</p>
                  <strong>{enabledGamesCount}</strong>
                  <span>Jogos ativos no launcher.</span>
                </article>

                <article className="card overview-card">
                  <p className="kicker">DESATIVADOS</p>
                  <strong>{disabledGamesCount}</strong>
                  <span>Jogos pausados/ocultos.</span>
                </article>

                <article className="card overview-card">
                  <p className="kicker">STAFFS</p>
                  <strong>{admins.length}</strong>
                  <span>{adminsLoading ? "Atualizando lista..." : "Usuarios com acesso admin."}</span>
                </article>

                <article className="card overview-card">
                  <p className="kicker">ULTIMA ATUALIZACAO</p>
                  <strong>{latestCatalogUpdate ? formatTimestamp(latestCatalogUpdate) : "-"}</strong>
                  <span>Referencia do catalogo.</span>
                </article>
              </div>

              <div className="details-grid details-grid-home">
                <section className="card panel">
                  <div className="panel-head">
                    <div>
                      <p className="kicker">LISTAS</p>
                      <h2>Ultimos jogos cadastrados</h2>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="staff-table">
                      <thead>
                        <tr>
                          <th>Jogo</th>
                          <th>ID</th>
                          <th>Atualizado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gamesLoading ? <tr><td colSpan={3}>Carregando jogos...</td></tr> : null}
                        {!gamesLoading && games.length === 0 ? <tr><td colSpan={3}>Nenhum jogo cadastrado.</td></tr> : null}
                        {games.slice(0, 8).map((game) => (
                          <tr key={game.id}>
                            <td>{game.name || "-"}</td>
                            <td><code>{game.id || "-"}</code></td>
                            <td>{formatTimestamp(game.updated_at || game.created_at || "")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="card panel">
                  <div className="panel-head">
                    <div>
                      <p className="kicker">STAFFS</p>
                      <h2>Lista resumida</h2>
                      <button
                        className={`button button-small maintenance-alert-btn maintenance-overview-trigger ${maintenanceFlag.enabled ? "is-active" : ""}`}
                        onClick={() => {
                          setIsMaintenanceModalOpen(true);
                          void loadMaintenanceFlag();
                        }}
                        type="button"
                      >
                        Manutencao {maintenanceFlag.enabled ? "ATIVA" : "INATIVA"}
                      </button>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="staff-table">
                      <thead>
                        <tr>
                          <th>Perfil Steam</th>
                          <th>Cargo</th>
                          <th>SteamID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminsLoading ? <tr><td colSpan={3}>Carregando staffs...</td></tr> : null}
                        {!adminsLoading && admins.length === 0 ? <tr><td colSpan={3}>Nenhum staff autorizado.</td></tr> : null}
                        {admins.slice(0, 8).map((admin) => {
                          const avatarUrl = resolveStaffAvatarUrl(admin);
                          return (
                            <tr key={admin.steamId}>
                              <td>
                                <div className="staff-profile">
                                  {avatarUrl ? (
                                    <img alt={admin.steamProfile?.displayName || admin.staffName || "Steam User"} src={avatarUrl} />
                                  ) : (
                                    <span className="staff-avatar-fallback">ST</span>
                                  )}
                                  <div>
                                    <strong>{admin.steamProfile?.displayName || admin.staffName || "Steam User"}</strong>
                                    <span>{admin.steamProfile?.profileUrl || `https://steamcommunity.com/profiles/${admin.steamId}`}</span>
                                  </div>
                                </div>
                              </td>
                              <td>{formatRoleLabel(admin.staffRole)}</td>
                              <td><code>{admin.steamId}</code></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          {dashboardSection === "jogos" && view === "catalog" ? (
        <section className="catalog-shell">
          <div className="catalog-head">
            <input
              className="catalog-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar jogo por nome/ID..."
              value={search}
            />
            <div className="catalog-actions">
              <button className="button button-ghost" onClick={() => void refreshDashboardData()} type="button">
                Atualizar dashboard
              </button>
              <button className="button button-primary" disabled={!canPublishGames} onClick={openNewGame} type="button">
                Adicionar novo jogo
              </button>
            </div>
          </div>
          {canEditGames ? (
            <article className={`catalog-reorder-guide ${catalogDragActive ? "is-active" : ""}`}>
              {isSavingCatalogOrder
                ? "Salvando nova ordem no launcher..."
                : search.trim()
                  ? "Limpe a busca para reorganizar por arrastar e soltar."
                  : catalogDragActive
                    ? `Arrastando ${draggedCatalogGame?.name || "jogo"} com reordenacao em tempo real. Solte para salvar.`
                    : "Arraste um jogo para definir a ordem de exibicao no launcher. Os cards se reorganizam em tempo real."}
            </article>
          ) : null}
          {!canEditGames ? (
            <article className="card catalog-empty">
              Seu cargo {formatRoleLabel(viewerRole)} nao pode editar jogos existentes.
            </article>
          ) : null}
          {gamesLoading ? <article className="card catalog-empty">Carregando jogos...</article> : null}
          {!gamesLoading && filteredGames.length === 0 ? (
            <article className="card catalog-empty">Nenhum jogo encontrado.</article>
          ) : null}
          <div
            className={`game-catalog-grid ${catalogDragActive ? "is-dragging is-live-reorder" : ""}`}
            onDragOver={onCatalogGridDragOver}
            onDrop={onCatalogGridDrop}
          >
            {filteredGames.map((game) => {
              const cover = coverUrl(game);
              const allCandidates = coverCandidates(game);
              const isDragSource = catalogDragActive && draggedCatalogGameId === game.id;
              const isDropTarget = catalogDragActive && catalogDropTargetGameId === game.id;
              const dropPlacementClass = isDropTarget
                ? catalogDropPlacement === "before"
                  ? "is-drop-before"
                  : "is-drop-after"
                : "";
              return (
                <article
                  className={`game-card-shell ${isDragSource ? "is-drag-source" : ""} ${isDropTarget ? "is-drop-target" : ""} ${dropPlacementClass}`}
                  draggable={isCatalogReorderEnabled}
                  key={game.id}
                  onDragEnd={onCatalogDragEnd}
                  onDragOver={(event) => onCatalogCardDragOver(event, game.id)}
                  onDragStart={(event) => onCatalogDragStart(event, game.id)}
                  onDrop={(event) => onCatalogCardDrop(event, game.id)}
                >
                  <button
                    className="game-card game-card-poster"
                    disabled={!canEditGames || isSavingCatalogOrder}
                    onClick={() => {
                      if (catalogDragActive) return;
                      openEditor(game);
                    }}
                    type="button"
                  >
                    <div className="game-card-media">
                      {cover ? (
                        <img
                          alt={game.name}
                          data-cover-candidates={allCandidates.map((entry) => encodeURIComponent(entry)).join("|")}
                          data-cover-index="0"
                          decoding="async"
                          loading="lazy"
                          onError={onGameCardImageError}
                          referrerPolicy="no-referrer"
                          src={cover}
                        />
                      ) : null}
                      <span className={`game-card-fallback ${cover ? "" : "is-visible"}`}>Sem imagem</span>
                      <div className="game-card-overlay">
                        <strong>{game.name || "Sem nome"}</strong>
                        <span>{game.id}</span>
                      </div>
                    </div>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

          {dashboardSection === "jogos" && view !== "catalog" && showUploadOnlyStage ? (
        <section className="upload-only-shell">
          <article className="card upload-link-card">
            <header className="upload-link-head">
              <p className="kicker">NOVO JOGO</p>
              <h2>Cole o link do arquivo (Drive/Dropbox)</h2>
              <p className="text-muted">
                Continue com o link direto do arquivo `.rar/.zip` no Google Drive ou Dropbox.
              </p>
            </header>
            <label className="upload-link-field">
              <span>Link de arquivo remoto</span>
              <input
                onChange={(event) => setDriveLinkStageInput(event.target.value)}
                onBlur={() => {
                  const converted = resolveDownloadUrlInput(driveLinkStageInput).url;
                  if (converted) setDriveLinkStageInput(converted);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    continueWithRemoteLink();
                  }
                }}
                placeholder="https://drive.google.com/file/d/FILE_ID/view?usp=sharing ou https://www.dropbox.com/s/... ?dl=1"
                value={driveLinkStageInput}
              />
            </label>
            <div className="upload-only-actions">
              <button className="button button-primary" onClick={continueWithRemoteLink} type="button">
                Continuar com link
              </button>
              <button className="button button-ghost" onClick={continueWithoutDownloadSource} type="button">
                Continuar sem link (Coming Soon)
              </button>
              {draftUpdatedAt ? (
                <button className="button button-ghost" onClick={restoreEditorDraft} type="button">
                  Restaurar rascunho
                </button>
              ) : null}
              <button className="button button-ghost" onClick={leaveEditor} type="button">Voltar</button>
            </div>
          </article>
        </section>
      ) : null}

          {dashboardSection === "jogos" && view !== "catalog" && !showUploadOnlyStage ? (
        <div className="details-grid details-grid-single">
          <section className="card panel">
            <div className="panel-head">
              <div>
                <p className="kicker">{editorMode === "edit" ? "EDITAR JOGO" : "NOVO JOGO"}</p>
                <h2>Formulario de publicacao</h2>
                <p className={`editor-status ${isDirty ? "is-dirty" : "is-clean"}`}>
                  {isDirty ? "Alteracoes nao salvas" : "Tudo salvo"}
                </p>
              </div>
              <div className="editor-actions">
                <button className="button button-ghost" onClick={leaveEditor} type="button">Voltar</button>
                <button className="button button-ghost" onClick={() => fileInputRef.current?.click()} type="button">
                  {archiveFile ? "Trocar arquivo" : "Selecionar arquivo"}
                </button>
                {editorMode === "new" && linkedDriveUrl ? (
                  <button
                    className="button button-ghost"
                    onClick={() => {
                      setLinkedDriveFileId("");
                      setLinkedDriveUrl("");
                      if (!archiveFile) setDriveLinkStageInput("");
                    }}
                    type="button"
                  >
                    Trocar link
                  </button>
                ) : null}
              </div>
            </div>

            <div className="file-pill">
              <strong>
                {archiveFile?.name ||
                  (linkedDriveUrl
                    ? linkedDriveFileId
                      ? "Arquivo remoto (Google Drive)"
                      : isDropboxLink(linkedDriveUrl)
                        ? "Arquivo remoto (Dropbox)"
                        : "Arquivo remoto"
                    : editingGame?.google_drive_file_id || editingGame?.download_url || editingGame?.download_urls?.[0]
                      ? "Sem upload novo"
                      : "Nenhum arquivo")}
              </strong>
              <span>
                {archiveFile
                  ? `${Math.max(1, Math.round(archiveFile.size / (1024 * 1024)))} MB`
                  : linkedDriveFileId
                    ? linkedDriveFileId
                    : linkedDriveUrl
                      ? compactText(linkedDriveUrl, 72)
                      : editingGame?.google_drive_file_id || editingGame?.download_url || editingGame?.download_urls?.[0] || "-"}
              </span>
            </div>
            {editorMode === "edit" ? (
              <label className="primary-download-field">
                <span>Link principal de download</span>
                <div className={`primary-download-input-wrap ${canEditGames ? "is-editable" : ""}`}>
                  <input placeholder="Nenhum link principal definido." readOnly value={primaryDownloadLink} />
                  {canEditGames ? (
                    <button
                      aria-label="Editar link principal"
                      className="primary-download-edit-button"
                      onClick={openPrimaryDownloadModal}
                      type="button"
                    >
                      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                        <path d="m12 6 4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </label>
            ) : null}
            {linkedDriveUrl ? <p className="field-hint">Link remoto ativo: {compactText(linkedDriveUrl, 96)}</p> : null}

            <section className="smart-assistant">
              <div className="smart-assistant-head">
                <div>
                  <strong>Assistente inteligente</strong>
                  <span>{completionPercent}% do formulario concluido. Modo: {editorLayoutMode === "simplified" ? "Simplificado" : "Completo"}</span>
                </div>
                <div className="smart-control-stack">
                  <div className="editor-layout-toggle" role="tablist">
                    <button
                      aria-selected={editorLayoutMode === "simplified"}
                      className={`editor-layout-option ${editorLayoutMode === "simplified" ? "is-active" : ""}`}
                      onClick={() => setLayoutMode("simplified")}
                      role="tab"
                      type="button"
                    >
                      Simplificado
                    </button>
                    <button
                      aria-selected={editorLayoutMode === "complete"}
                      className={`editor-layout-option ${editorLayoutMode === "complete" ? "is-active" : ""}`}
                      onClick={() => setLayoutMode("complete")}
                      role="tab"
                      type="button"
                    >
                      Completo
                    </button>
                  </div>

                  <div className="smart-draft-actions">
                    {editorMode === "new" ? (
                      <>
                        <button className="button button-ghost button-small" onClick={restoreEditorDraft} type="button">Restaurar rascunho</button>
                        <button className="button button-ghost button-small" onClick={clearEditorDraft} type="button">Limpar rascunho</button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <div aria-valuemax={100} aria-valuemin={0} aria-valuenow={completionPercent} className="smart-progress" role="progressbar">
                <span style={{ width: `${completionPercent}%` }} />
              </div>

              <div className="smart-checks">
                {editorChecklist.map((item) => (
                  <span className={`smart-check ${item.ok ? "is-ok" : "is-pending"}`} key={item.label}>
                    {item.ok ? "OK" : "Pendente"} {item.label}
                  </span>
                ))}
              </div>

              <div className="smart-actions">
                <button className="button button-secondary button-small" onClick={applyGalleryAsMainMedia} type="button">Auto capa pela galeria</button>
                <button className="button button-secondary button-small" onClick={syncAllMediaWithCard} type="button">Sincronizar midias</button>
                <button className="button button-secondary button-small" onClick={applyFreePricingPreset} type="button">Preset gratuito</button>
                <button className="button button-secondary button-small" onClick={applySizeLabelFromBytes} type="button">Gerar size_label</button>
                <button className="button button-secondary button-small" onClick={normalizeUrlFields} type="button">Normalizar URLs</button>
              </div>

              <div className="smart-preview">
                <div className="smart-preview-card">
                  <div className="smart-preview-media">
                    {cardPreviewUrl ? (
                      <img
                        alt={form.name || "Preview do jogo"}
                        decoding="async"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        src={cardPreviewUrl}
                      />
                    ) : (
                      <span>Sem capa</span>
                    )}
                  </div>
                  <div className="smart-preview-text">
                    <strong>{form.name || "Sem nome"}</strong>
                    <span>{resolvedId || "-"}</span>
                  </div>
                </div>
                <p className="field-hint">
                  Atalho: <code>Ctrl+S</code> para salvar.{" "}
                  {draftUpdatedAt ? `Rascunho atualizado em ${formatTimestamp(draftUpdatedAt)}.` : "Rascunho ainda nao salvo."}
                </p>
              </div>
            </section>

            <form className="game-form" onSubmit={saveGame} ref={formRef}>
              <div className="field-grid">
                <div className="form-section-title full-width">
                  <strong>Campos essenciais</strong>
                  <span>Fluxo rapido para publicar: identidade, capa, links e download.</span>
                </div>

                <label><span>Nome *</span><input onChange={(event) => updateField("name", event.target.value)} placeholder="Ex: House Flipper 2" required value={form.name} /></label>
                <label><span>ID</span><input disabled={editorMode === "edit"} onChange={(event) => updateField("id", event.target.value)} placeholder="Gerado automaticamente" value={form.id} /></label>
                <label><span>Secao</span><input onChange={(event) => updateField("section", event.target.value)} placeholder="Catalogo" value={form.section} /></label>
                <label className="full-width"><span>ID final</span><input disabled value={resolvedId} /></label>
                <label className="full-width"><span>Descricao curta</span><textarea onChange={(event) => updateField("description", event.target.value)} placeholder="Resumo rapido do jogo." rows={2} value={form.description} /></label>
                <label><span>Archive type</span><select onChange={(event) => updateField("archiveType", event.target.value as "rar" | "zip")} value={form.archiveType}><option value="rar">rar</option><option value="zip">zip</option></select></label>
                <label><span>Archive password</span><input onChange={(event) => updateField("archivePassword", event.target.value)} value={form.archivePassword} /></label>
                <label className="full-width">
                  <span>Steam URL</span>
                  <input
                    className={!isSteamIdValid ? "is-invalid" : undefined}
                    onChange={(event) => updateField("steamUrl", event.target.value)}
                    placeholder="https://store.steampowered.com/app/2881650/Content_Warning/"
                    type="url"
                    value={form.steamUrl}
                  />
                  {!isSteamIdValid ? (
                    <small className="input-hint is-error">Use um link Steam no formato /app/ID.</small>
                  ) : null}
                </label>
                <label>
                  <span>Steam app ID (gerado automaticamente)</span>
                  <input
                    disabled
                    inputMode="numeric"
                    placeholder="Ex: 2881650"
                    value={form.steamAppId}
                  />
                </label>
                <label><span>image_url</span><input onChange={(event) => updateField("imageUrl", event.target.value)} placeholder="https://.../image.png" type="url" value={form.imageUrl} /></label>
                <label><span>card_image_url</span><input onChange={(event) => updateField("cardImageUrl", event.target.value)} placeholder="https://.../card.png" type="url" value={form.cardImageUrl} /></label>

                <div className="advanced-toggle-row full-width">
                  <div>
                    <strong>Campos avancados</strong>
                    <span>Metadados, instalacao e precificacao.</span>
                  </div>
                  {editorLayoutMode === "simplified" ? (
                    <button className="button button-ghost button-small" onClick={toggleAdvancedFields} type="button">
                      {shouldShowAdvancedFields ? "Ocultar avancados" : "Mostrar avancados"}
                    </button>
                  ) : (
                    <span className="field-hint">Visivel no modo completo.</span>
                  )}
                </div>

                {shouldShowAdvancedFields ? (
                  <>
                    <label className="full-width"><span>Descricao longa</span><textarea onChange={(event) => updateField("longDescription", event.target.value)} placeholder="Detalhes completos, recursos, modo online, etc." rows={4} value={form.longDescription} /></label>
                    <label><span>install_dir_name</span><input onChange={(event) => updateField("installDirName", event.target.value)} placeholder="Nome da pasta de instalacao" value={form.installDirName} /></label>
                    <label><span>launch_executable</span><input onChange={(event) => updateField("launchExecutable", event.target.value)} placeholder="Jogo.exe" value={form.launchExecutable} /></label>
                    <label><span>banner_url</span><input onChange={(event) => updateField("bannerUrl", event.target.value)} placeholder="https://.../banner.png" type="url" value={form.bannerUrl} /></label>
                    <label><span>logo_url</span><input onChange={(event) => updateField("logoUrl", event.target.value)} placeholder="https://.../logo.png" type="url" value={form.logoUrl} /></label>
                    <label><span>trailer_url</span><input onChange={(event) => updateField("trailerUrl", event.target.value)} placeholder="https://..." type="url" value={form.trailerUrl} /></label>
                    <label><span>developed_by</span><input onChange={(event) => updateField("developedBy", event.target.value)} value={form.developedBy} /></label>
                    <label><span>published_by</span><input onChange={(event) => updateField("publishedBy", event.target.value)} value={form.publishedBy} /></label>
                    <label>
                      <span>release_date</span>
                      <input
                        className={!isReleaseDateValid ? "is-invalid" : undefined}
                        onChange={(event) => updateField("releaseDate", event.target.value)}
                        onBlur={() => {
                          void normalizeReleaseDateField(false);
                        }}
                        placeholder="YYYY-MM-DD"
                        value={form.releaseDate}
                      />
                      {!isReleaseDateValid ? (
                        <small className="input-hint is-error">Use uma data valida. Ex: 2025-02-26 ou 26 Feb 2025.</small>
                      ) : null}
                    </label>
                    <label><span>size_bytes</span><input inputMode="numeric" onChange={(event) => updateField("sizeBytes", event.target.value)} value={form.sizeBytes} /></label>
                    <label><span>size_label</span><input onChange={(event) => updateField("sizeLabel", event.target.value)} placeholder="Ex: 18.6 GB" value={form.sizeLabel} /></label>
                    <label><span>current_price</span><input onChange={(event) => updateField("currentPrice", event.target.value)} value={form.currentPrice} /></label>
                    <label><span>original_price</span><input onChange={(event) => updateField("originalPrice", event.target.value)} value={form.originalPrice} /></label>
                    <label><span>discount_percent</span><input onChange={(event) => updateField("discountPercent", event.target.value)} value={form.discountPercent} /></label>
                    <label><span>sort_order</span><input inputMode="numeric" onChange={(event) => updateField("sortOrder", event.target.value)} value={form.sortOrder} /></label>
                  </>
                ) : (
                  <p className="field-hint full-width">Campos avancados recolhidos para acelerar o preenchimento.</p>
                )}

                <div className="enhanced-field full-width">
                  <span>genres (tags)</span>
                  <div className="chips-field">
                    <div className="chips-input-row">
                      <input
                        onChange={(event) => setGenreInput(event.target.value)}
                        onKeyDown={onGenreInputKeyDown}
                        placeholder="Digite uma tag e pressione Enter (acao, coop, online...)"
                        value={genreInput}
                      />
                      <button className="button button-secondary button-small" onClick={addGenresFromInput} type="button">
                        Aplicar tag
                      </button>
                    </div>
                    {genreItems.length > 0 ? (
                      <div className="chip-list">
                        {genreItems.map((tag) => (
                          <span className="chip" key={tag}>
                            {tag}
                            <button aria-label={`Remover tag ${tag}`} onClick={() => removeGenre(tag)} type="button">x</button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="field-hint">Nenhuma tag aplicada ainda.</p>
                    )}
                  </div>
                </div>

                <div className="enhanced-field full-width">
                  <span>gallery</span>
                  <div className="gallery-builder">
                    <div className="gallery-toolbar">
                      <input
                        onChange={(event) => setGalleryInput(event.target.value)}
                        onBlur={() => {
                          const normalized = normalizeGalleryMediaUrl(galleryInput);
                          if (normalized && normalized !== galleryInput) {
                            setGalleryInput(normalized);
                          }
                        }}
                        onKeyDown={onGalleryInputKeyDown}
                        placeholder="Cole a URL da imagem e pressione Enter"
                        type="url"
                        value={galleryInput}
                      />
                      <button className="button button-secondary button-small" onClick={addGalleryFromInput} type="button">
                        Adicionar URL
                      </button>
                      <button
                        className="button button-ghost button-small"
                        disabled={isUploadingGallery}
                        onClick={() => galleryUploadInputRef.current?.click()}
                        type="button"
                      >
                        {isUploadingGallery ? "Enviando..." : "Upload PNG/JPG"}
                      </button>
                      <input
                        accept=".png,.jpg,.jpeg,.webp,.gif,.avif"
                        className="hidden-input"
                        multiple
                        onChange={onGalleryUploadChange}
                        ref={galleryUploadInputRef}
                        type="file"
                      />
                    </div>

                    {galleryItems.length > 0 ? (
                      <div className="gallery-preview-grid">
                        {galleryItems.map((item, index) => (
                          <article
                            className={`gallery-preview-card ${draggedGalleryIndex === index ? "is-dragging" : ""} ${galleryDropIndex === index ? "is-drop-target" : ""}`}
                            draggable
                            key={`${item}-${index}`}
                            onDragEnd={onGalleryDragEnd}
                            onDragOver={(event) => onGalleryDragOver(event, index)}
                            onDragStart={(event) => onGalleryDragStart(event, index)}
                            onDrop={(event) => onGalleryDrop(event, index)}
                          >
                            <div className="gallery-order-handle">#{index + 1} Arraste para ordenar</div>
                            <img alt={`Preview ${index + 1}`} loading="lazy" src={item} />
                            <div className="gallery-preview-meta">
                              <p title={item}>{compactText(item, 56)}</p>
                              <div className="gallery-preview-actions">
                                <button
                                  className="button button-ghost button-small"
                                  disabled={index === 0}
                                  onClick={() => moveGalleryItem(index, -1)}
                                  type="button"
                                >
                                  Subir
                                </button>
                                <button
                                  className="button button-ghost button-small"
                                  disabled={index === galleryItems.length - 1}
                                  onClick={() => moveGalleryItem(index, 1)}
                                  type="button"
                                >
                                  Descer
                                </button>
                                <button className="button button-ghost button-small" onClick={() => applyGalleryImageAsCover(item)} type="button">
                                  Usar como capa
                                </button>
                                <button className="button button-danger button-small" onClick={() => removeGalleryItem(item)} type="button">
                                  Remover
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="field-hint">Nenhuma imagem na galeria. Voce pode colar URL ou fazer upload direto.</p>
                    )}
                  </div>
                </div>

                <label className="full-width">
                  <span>download_urls</span>
                  <textarea
                    onChange={(event) => updateField("downloadUrls", event.target.value)}
                    onBlur={() =>
                      updateField(
                        "downloadUrls",
                        uniqueList(parseListText(form.downloadUrls).map(normalizeDownloadUrlInput)).join("\n")
                      )
                    }
                    placeholder="Uma URL por linha"
                    rows={2}
                    value={form.downloadUrls}
                  />
                </label>
              </div>

              <div className="checkbox-grid">
                <label className="checkbox-item"><input checked={form.free} onChange={(event) => updateField("free", event.target.checked)} type="checkbox" /><span>free</span></label>
                <label className="checkbox-item"><input checked={form.exclusive} onChange={(event) => updateField("exclusive", event.target.checked)} type="checkbox" /><span>exclusive</span></label>
                <label className="checkbox-item"><input checked={form.comingSoon} onChange={(event) => onComingSoonToggle(event.target.checked)} type="checkbox" /><span>coming_soon</span></label>
                <label className="checkbox-item"><input checked={form.enabled} onChange={(event) => updateField("enabled", event.target.checked)} type="checkbox" /><span>enabled</span></label>
              </div>

              <section className="json-live-panel">
                <div className="json-live-head">
                  <strong>JSON em tempo real</strong>
                  <span>Atualiza automaticamente conforme voce preenche.</span>
                </div>
                <textarea
                  className="json-live-textarea"
                  readOnly
                  rows={12}
                  value={liveEditorJson}
                />
              </section>

              <div className="panel-actions">
                <button
                  className="button button-ghost"
                  disabled={isSaving || isUploadingGallery}
                  onClick={() => void copyEditorJsonToClipboard()}
                  type="button"
                >
                  Copiar .JSON
                </button>
                <button
                  className="button button-ghost"
                  disabled={isSaving || isUploadingGallery}
                  onClick={openJsonImportDialog}
                  type="button"
                >
                  Importar .JSON
                </button>
                <button className="button button-primary" disabled={isSaving} type="submit">
                  {isSaving ? "Salvando..." : editorMode === "edit" ? "Salvar alteracoes" : "Publicar jogo"}
                </button>
              </div>
            </form>
          </section>

        </div>
      ) : null}

          {dashboardSection === "administracao" ? (
            <section className="details-grid details-grid-single">
              <section className="card panel">
                <div className="panel-head">
                  <div>
                    <p className="kicker">SEGURANCA</p>
                    <h2>Staffs autorizados</h2>
                    <p className="text-muted">
                      {canManageStaff
                        ? "Developer pode adicionar/remover cargos."
                        : "Seu cargo e somente leitura nesta area."}
                    </p>
                  </div>
                  {canManageStaff ? (
                    <div className="panel-head-actions">
                      <button className="button button-add-staff" onClick={openAddStaffModal} type="button">
                        Adicionar staff
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="table-wrap">
                  <table className="staff-table">
                    <thead>
                      <tr>
                        <th>Perfil Steam</th>
                        <th>Cargo</th>
                        <th>SteamID</th>
                        <th>Criado em</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {adminsLoading ? <tr><td colSpan={5}>Carregando staffs...</td></tr> : null}
                      {!adminsLoading && admins.length === 0 ? <tr><td colSpan={5}>Nenhum staff autorizado.</td></tr> : null}
                      {admins.map((admin) => {
                        const avatarUrl = resolveStaffAvatarUrl(admin);
                        return (
                          <tr key={admin.steamId}>
                            <td>
                              <div className="staff-profile">
                                {avatarUrl ? (
                                  <img alt={admin.steamProfile?.displayName || admin.staffName || "Steam User"} src={avatarUrl} />
                                ) : (
                                  <span className="staff-avatar-fallback">ST</span>
                                )}
                                <div>
                                  <strong>{admin.steamProfile?.displayName || admin.staffName || "Steam User"}</strong>
                                  <span>{admin.steamProfile?.profileUrl || `https://steamcommunity.com/profiles/${admin.steamId}`}</span>
                                </div>
                              </div>
                            </td>
                            <td>{formatRoleLabel(admin.staffRole)}</td>
                            <td><code>{admin.steamId}</code></td>
                            <td>{formatTimestamp(admin.createdAt)}</td>
                            <td>
                              <div className="staff-row-actions">
                                <button
                                  className="button button-ghost button-small"
                                  disabled={!canManageStaff || isManagingStaff}
                                  onClick={() => openStaffRoleEditor(admin)}
                                  type="button"
                                >
                                  Editar
                                </button>
                                <button
                                  className="button button-danger button-small"
                                  disabled={!canManageStaff || isManagingStaff || admins.length <= 1}
                                  onClick={() => removeStaff(admin.steamId)}
                                  type="button"
                                >
                                  Remover
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          ) : null}
        </section>
      </div>

      {isPrimaryDownloadModalOpen ? (
        <aside className="confirm-overlay" onClick={closePrimaryDownloadModal} role="dialog">
          <article className="card confirm-card primary-download-modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="kicker">LINK PRINCIPAL</p>
            <h3>Editar download principal</h3>
            <p className="text-muted">
              Este link vira o principal do jogo no launcher e sera salvo imediatamente no banco.
            </p>
            <label>
              <span>Novo link principal</span>
              <input
                autoFocus
                onChange={(event) => setPrimaryDownloadDraft(event.target.value)}
                onBlur={() => {
                  const converted = resolveDownloadUrlInput(primaryDownloadDraft).url;
                  if (converted && converted !== primaryDownloadDraft) {
                    setPrimaryDownloadDraft(converted);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void savePrimaryDownloadLink();
                  }
                }}
                placeholder="https://www.dropbox.com/s/... ?dl=1"
                value={primaryDownloadDraft}
              />
            </label>
            <p className="field-hint">Dica: links de arquivo do Google Drive e Dropbox sao convertidos automaticamente.</p>
            <div className="confirm-actions">
              <button className="button button-ghost" disabled={isSavingPrimaryDownload} onClick={closePrimaryDownloadModal} type="button">
                Cancelar
              </button>
              <button className="button button-primary" disabled={isSavingPrimaryDownload} onClick={() => void savePrimaryDownloadLink()} type="button">
                {isSavingPrimaryDownload ? "Salvando..." : "Salvar link principal"}
              </button>
            </div>
          </article>
        </aside>
      ) : null}

      {isMaintenanceModalOpen ? (
        <aside className="confirm-overlay" onClick={() => setIsMaintenanceModalOpen(false)} role="dialog">
          <article className="card confirm-card maintenance-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="maintenance-overview-head">
              <div>
                <p className="kicker">MANUTENCAO DO SITE</p>
                <h3>{maintenanceFlag.title || DEFAULT_MAINTENANCE_FLAG.title}</h3>
              </div>
              <span className={`maintenance-state-pill ${maintenanceFlag.enabled ? "is-on" : "is-off"}`}>
                {maintenanceFlag.enabled ? "ATIVA" : "INATIVA"}
              </span>
            </div>
            <p className="maintenance-note">
              {maintenanceFlag.message || DEFAULT_MAINTENANCE_FLAG.message}
            </p>
            {!canManageMaintenance ? (
              <p className="text-muted">Seu cargo so pode visualizar o status de manutencao.</p>
            ) : null}
            <div className="maintenance-fields">
              <label className="compact-field">
                <span>Titulo</span>
                <input
                  disabled={!canManageMaintenance}
                  onChange={(event) => setMaintenanceTitleDraft(event.target.value)}
                  placeholder="Titulo do aviso de manutencao"
                  value={maintenanceTitleDraft}
                />
              </label>
              <label className="compact-field">
                <span>Mensagem</span>
                <textarea
                  disabled={!canManageMaintenance}
                  onChange={(event) => setMaintenanceMessageDraft(event.target.value)}
                  rows={3}
                  value={maintenanceMessageDraft}
                />
              </label>
            </div>
            <div className="maintenance-actions">
              <button
                className={`button button-small ${maintenanceFlag.enabled ? "button-danger" : "button-secondary"}`}
                disabled={maintenanceLoading || isSavingMaintenance || !canManageMaintenance}
                onClick={() =>
                  void saveMaintenanceFlag({
                    enabled: !maintenanceFlag.enabled,
                    title: maintenanceTitleDraft,
                    message: maintenanceMessageDraft
                  }, !maintenanceFlag.enabled ? "Modo manutencao ativado com sucesso." : "Modo manutencao desativado com sucesso.")
                }
                type="button"
              >
                {maintenanceFlag.enabled ? "Desativar manutencao" : "Ativar manutencao"}
              </button>
              <button
                className="button button-ghost button-small"
                disabled={maintenanceLoading || isSavingMaintenance || !canManageMaintenance}
                onClick={() =>
                  void saveMaintenanceFlag({
                    enabled: maintenanceFlag.enabled,
                    title: maintenanceTitleDraft,
                    message: maintenanceMessageDraft
                  }, "Aviso de manutencao atualizado.")
                }
                type="button"
              >
                Salvar aviso
              </button>
              <button
                className="button button-ghost button-small"
                disabled={maintenanceLoading || isSavingMaintenance}
                onClick={() => void loadMaintenanceFlag()}
                type="button"
              >
                Recarregar
              </button>
            </div>
            <p className="maintenance-meta">
              {maintenanceLoading
                ? "Carregando status..."
                : `Atualizado em ${formatTimestamp(maintenanceFlag.updatedAt || maintenanceFlag.createdAt || "")}`}
            </p>
            <div className="confirm-actions">
              <button className="button button-ghost" onClick={() => setIsMaintenanceModalOpen(false)} type="button">
                Fechar
              </button>
            </div>
          </article>
        </aside>
      ) : null}

      {isJsonImportOpen ? (
        <aside className="confirm-overlay" role="dialog">
          <article className="card confirm-card json-import-card">
            <p className="kicker">IMPORTAR JSON</p>
            <h3>Colar metadados do jogo</h3>
            <p className="text-muted">
              Aceita o JSON exportado por este painel ou um objeto com campos do jogo.
            </p>
            <textarea
              className="json-import-textarea"
              onChange={(event) => setJsonImportInput(event.target.value)}
              placeholder='{"form":{"name":"Meu Jogo","section":"Catalogo"}}'
              rows={14}
              value={jsonImportInput}
            />
            <div className="confirm-actions">
              <button className="button button-ghost" onClick={closeJsonImportDialog} type="button">
                Cancelar
              </button>
              <button className="button button-primary" onClick={applyJsonImport} type="button">
                Importar JSON
              </button>
            </div>
          </article>
        </aside>
      ) : null}

      {isAddStaffModalOpen ? (
        <aside className="confirm-overlay" onClick={closeAddStaffModal} role="dialog">
          <article className="card confirm-card add-staff-modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="kicker">NOVO STAFF</p>
            <h3>Adicionar staff autorizado</h3>
            <p className="text-muted">
              Cole o link de perfil Steam ou o SteamID. O sistema tenta extrair o ID automaticamente.
            </p>

            <form
              className="add-staff-form"
              onSubmit={(event) => {
                event.preventDefault();
                void addStaff();
              }}
            >
              <label>
                <span>Link da Steam ou SteamID</span>
                <input
                  onChange={(event) => setStaffSteamId(event.target.value)}
                  placeholder="https://steamcommunity.com/profiles/7656... ou 7656..."
                  value={staffSteamId}
                />
              </label>

              <p className={`staff-extract-hint ${extractedStaffSteamId ? "is-valid" : "is-invalid"}`}>
                {extractedStaffSteamId ? (
                  <>
                    SteamID extraido: <code>{extractedStaffSteamId}</code>
                  </>
                ) : (
                  "Cole um link /profiles/ ou um SteamID valido de 17 digitos."
                )}
              </p>

              <label>
                <span>Cargo</span>
                <select
                  onChange={(event) => setStaffRole(normalizeStaffRole(event.target.value))}
                  value={staffRole}
                >
                  <option value="staff">Staff (somente leitura)</option>
                  <option value="administrador">Administrador</option>
                  <option value="developer">Developer</option>
                </select>
              </label>

              <div className="confirm-actions">
                <button className="button button-ghost" disabled={isManagingStaff} onClick={closeAddStaffModal} type="button">
                  Cancelar
                </button>
                <button className="button button-primary" disabled={isManagingStaff} type="submit">
                  {isManagingStaff ? "Adicionando..." : "Adicionar staff"}
                </button>
              </div>
            </form>
          </article>
        </aside>
      ) : null}

      {editingStaffRecord ? (
        <aside className="confirm-overlay" onClick={closeStaffRoleEditor} role="dialog">
          <article className="card confirm-card staff-role-modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="kicker">EDITAR CARGO</p>
            <h3>{editingStaffRecord.steamProfile?.displayName || editingStaffRecord.staffName || "Staff"}</h3>
            <p className="text-muted">
              SteamID: <code>{editingStaffRecord.steamId}</code>
            </p>
            <label>
              <span>Cargo</span>
              <select
                className="staff-role-select"
                disabled={!canManageStaff || isManagingStaff}
                onChange={(event) => setEditingStaffRole(normalizeStaffRole(event.target.value))}
                value={editingStaffRole}
              >
                <option value="staff">Staff (somente leitura)</option>
                <option value="administrador">Administrador</option>
                <option value="developer">Developer</option>
              </select>
            </label>
            <div className="confirm-actions">
              <button
                className="button button-ghost"
                disabled={isManagingStaff}
                onClick={closeStaffRoleEditor}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="button button-primary"
                disabled={!canManageStaff || isManagingStaff}
                onClick={() => void saveStaffRoleEdit()}
                type="button"
              >
                {isManagingStaff ? "Salvando..." : "Salvar cargo"}
              </button>
            </div>
          </article>
        </aside>
      ) : null}

      {gameRemovalTarget ? (
        <aside className="confirm-overlay" role="dialog">
          <article className="card confirm-card">
            <p className="kicker">REMOVER JOGO</p>
            <h3>Confirmar remocao</h3>
            <p className="text-muted">
              Esta acao remove o jogo <strong>{gameRemovalTarget.name || gameRemovalTarget.id}</strong> do catalogo.
            </p>
            <div className="confirm-actions">
              <button
                className="button button-ghost"
                disabled={isRemovingGame}
                onClick={() => setGameRemovalTarget(null)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="button button-danger"
                disabled={isRemovingGame}
                onClick={() => void confirmGameRemoval()}
                type="button"
              >
                {isRemovingGame ? "Removendo..." : "Confirmar remocao"}
              </button>
            </div>
          </article>
        </aside>
      ) : null}

      {confirm.show ? (
        <aside className="confirm-overlay" role="dialog">
          <article className="card confirm-card">
            <p className="kicker">CONFIRMACAO</p>
            <h3>Jogo salvo com sucesso</h3>
            <p className="text-muted">ID: {confirm.gameId}</p>
            <p className="text-muted">Em: {formatTimestamp(confirm.at)}</p>
            <div className="confirm-actions">
              <button className="button button-ghost" onClick={() => setConfirm({ show: false, gameId: "", at: "" })} type="button">Fechar</button>
              <button className="button button-primary" onClick={openNewGame} type="button">Adicionar novo jogo</button>
            </div>
          </article>
        </aside>
      ) : null}

      {notice.msg ? (
        <div
          className={`alert ${notice.error ? "is-error" : "is-success"}`}
          onMouseEnter={handleNoticeMouseEnter}
          onMouseLeave={handleNoticeMouseLeave}
        >
          {notice.msg}
        </div>
      ) : null}
    </main>
  );
}

