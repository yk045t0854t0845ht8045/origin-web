// @ts-nocheck
const { requireAdmin, normalizeRole } = require("../../src/route-auth");
const {
  listAdminsFromSupabase,
  upsertAdminInSupabase,
  enrichAdminsWithSteamProfiles,
  inferAdminErrorStatus,
  readText
} = require("../../src/admins-supabase");
const { fetchSteamProfileBySteamId } = require("../../src/auth-core");
const { isValidSteamId } = require("../../src/utils");

async function handleList(req, res) {
  const viewer = await requireAdmin(req, res);
  if (!viewer) {
    return;
  }

  try {
    const admins = await listAdminsFromSupabase();
    const enrichedAdmins = await enrichAdminsWithSteamProfiles(admins);
    res.status(200).json({
      admins: enrichedAdmins
    });
  } catch (error) {
    res.status(inferAdminErrorStatus(error, 502)).json({
      error: "list_admins_failed",
      message: readText(error?.message, "Falha ao carregar staffs.")
    });
  }
}

async function handleCreate(req, res) {
  const viewer = await requireAdmin(req, res, {
    permission: "manageStaff",
    permissionMessage: "Seu cargo nao pode adicionar staffs."
  });
  if (!viewer) {
    return;
  }

  const steamId = readText(req.body?.steamId);
  if (!isValidSteamId(steamId)) {
    res.status(400).json({
      error: "invalid_steam_id",
      message: "SteamID invalido. Use 17 digitos."
    });
    return;
  }

  try {
    const steamProfile = await fetchSteamProfileBySteamId(steamId);
    const role = normalizeRole(req.body?.staffRole || req.body?.role, "staff");
    const admin = await upsertAdminInSupabase({
      steamId,
      staffName: readText(steamProfile?.displayName, steamId),
      staffRole: role
    });
    const enrichedAdmins = await enrichAdminsWithSteamProfiles(await listAdminsFromSupabase());
    const enrichedAdmin = enrichedAdmins.find((entry) => readText(entry?.steamId) === steamId) || admin;
    res.status(200).json({
      ok: true,
      admin: enrichedAdmin,
      admins: enrichedAdmins
    });
  } catch (error) {
    res.status(inferAdminErrorStatus(error, 400)).json({
      error: "invalid_admin_payload",
      message: readText(error?.message, "Falha ao salvar staff.")
    });
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    await handleList(req, res);
    return;
  }
  if (req.method === "POST") {
    await handleCreate(req, res);
    return;
  }

  res.status(405).json({
    error: "method_not_allowed",
    message: "Metodo nao permitido."
  });
}
