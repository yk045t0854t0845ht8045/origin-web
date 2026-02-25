// @ts-nocheck
const { requireAdmin } = require("../../../src/route-auth");
const {
  listAdminsFromSupabase,
  enrichAdminsWithSteamProfiles
} = require("../../../src/admins-supabase");
const {
  MAINTENANCE_FLAG_ID,
  defaultMaintenanceFlag,
  fetchLauncherGamesFromSupabase,
  fetchRuntimeFlagFromSupabase,
  getLauncherGamesCacheSnapshot,
  readText
} = require("../../../src/supabase-dashboard");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  const viewer = await requireAdmin(req, res);
  if (!viewer) {
    return;
  }

  const warnings = [];

  try {
    const [gamesResult, adminsResult, maintenanceResult] = await Promise.allSettled([
      fetchLauncherGamesFromSupabase({ limit: 500 }),
      (async () => {
        const admins = await listAdminsFromSupabase();
        return enrichAdminsWithSteamProfiles(admins);
      })(),
      fetchRuntimeFlagFromSupabase(MAINTENANCE_FLAG_ID)
    ]);

    const cacheSnapshot = getLauncherGamesCacheSnapshot();
    const games =
      gamesResult.status === "fulfilled"
        ? Array.isArray(gamesResult.value)
          ? gamesResult.value
          : []
        : Array.isArray(cacheSnapshot.data)
          ? cacheSnapshot.data
          : [];
    if (gamesResult.status !== "fulfilled") {
      warnings.push(`Jogos: ${readText(gamesResult.reason?.message, "fallback local ativo.")}`);
    }

    let admins = [];
    if (adminsResult.status === "fulfilled") {
      admins = Array.isArray(adminsResult.value) ? adminsResult.value : [];
    } else {
      warnings.push(`Staffs: ${readText(adminsResult.reason?.message, "fallback local ativo.")}`);
      admins = [];
    }

    let maintenance = defaultMaintenanceFlag();
    if (maintenanceResult.status === "fulfilled") {
      maintenance = maintenanceResult.value || defaultMaintenanceFlag();
    } else {
      warnings.push(`Manutencao: ${readText(maintenanceResult.reason?.message, "valor padrao aplicado.")}`);
    }

    res.status(200).json({
      ok: true,
      games,
      admins,
      maintenance,
      warnings
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "dashboard_bootstrap_failed",
      message: readText(error?.message, "Falha ao carregar dashboard.")
    });
  }
}
