function slugify(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80);
}

function isValidSteamId(value) {
  return /^\d{17}$/.test(String(value || "").trim());
}

function sanitizeDriveName(value, fallback = "item") {
  const safe = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!safe) {
    return fallback;
  }
  return safe.slice(0, 120);
}

module.exports = {
  slugify,
  isValidSteamId,
  sanitizeDriveName
};
