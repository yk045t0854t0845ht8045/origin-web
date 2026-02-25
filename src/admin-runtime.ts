// @ts-nocheck
const config = require("./config");
const { initDatabase } = require("./db");
const { createAdminStore } = require("./admin-store");
const { fetchSteamProfilesBySteamIds } = require("./auth-core");
const { isValidSteamId } = require("./utils");

const db = initDatabase(config);
db.bootstrapAdmins(config.bootstrapAdmins);
const adminStore = createAdminStore(config, db);

let adminStoreReady = false;
let adminStoreReadyPromise = null;
let adminStoreInitError = null;

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

async function ensureAdminStoreReady() {
  if (adminStoreReady) {
    return;
  }
  if (adminStoreReadyPromise) {
    return adminStoreReadyPromise;
  }

  adminStoreReadyPromise = (async () => {
    try {
      if (typeof adminStore.initialize === "function") {
        await adminStore.initialize();
      }
      adminStoreReady = true;
      adminStoreInitError = null;
    } catch (error) {
      adminStoreInitError = error;
      throw error;
    } finally {
      adminStoreReadyPromise = null;
    }
  })();

  return adminStoreReadyPromise;
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

async function enrichAdminsWithSteamProfiles(admins = []) {
  const list = Array.isArray(admins) ? admins : [];
  if (!list.length) {
    return [];
  }

  const steamIds = list
    .map((entry) => readText(entry?.steamId))
    .filter((entry) => isValidSteamId(entry));

  const profilesBySteamId = await fetchSteamProfilesBySteamIds(steamIds);
  return list.map((admin) => {
    const steamId = readText(admin?.steamId);
    const profile = profilesBySteamId.get(steamId) || null;
    const fallbackName = readText(admin?.staffName, steamId || "Staff");

    return {
      ...admin,
      steamId,
      staffName: readText(profile?.displayName, fallbackName),
      staffRole: normalizeRole(admin?.staffRole, "staff"),
      steamProfile: {
        steamId,
        displayName: readText(profile?.displayName, fallbackName),
        avatar: readText(profile?.avatar),
        profileUrl: readText(profile?.profileUrl, steamId ? `https://steamcommunity.com/profiles/${steamId}` : "")
      }
    };
  });
}

module.exports = {
  config,
  db,
  adminStore,
  ensureAdminStoreReady,
  inferAdminErrorStatus,
  enrichAdminsWithSteamProfiles,
  normalizeRole,
  readText,
  getAdminStoreInitError: () => adminStoreInitError
};

