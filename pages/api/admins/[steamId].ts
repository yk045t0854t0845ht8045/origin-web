// @ts-nocheck
const { requireAdmin, normalizeRole } = require("../../../src/route-auth");
const {
  listAdminsFromSupabase,
  updateAdminInSupabase,
  removeAdminInSupabase,
  enrichAdminsWithSteamProfiles,
  inferAdminErrorStatus,
  readText
} = require("../../../src/admins-supabase");
const { fetchSteamProfileBySteamId } = require("../../../src/auth-core");
const { isValidSteamId } = require("../../../src/utils");

function getSteamIdFromRequest(req) {
  const raw = req?.query?.steamId;
  if (Array.isArray(raw)) {
    return readText(raw[0]);
  }
  return readText(raw);
}

async function handleUpdate(req, res) {
  const viewer = await requireAdmin(req, res, {
    permission: "manageStaff",
    permissionMessage: "Seu cargo nao pode alterar staffs."
  });
  if (!viewer) {
    return;
  }

  const steamId = getSteamIdFromRequest(req);
  if (!isValidSteamId(steamId)) {
    res.status(400).json({
      error: "invalid_steam_id",
      message: "SteamID invalido."
    });
    return;
  }

  try {
    const steamProfile = await fetchSteamProfileBySteamId(steamId);
    const admin = await updateAdminInSupabase(steamId, {
      staffName: readText(steamProfile?.displayName, steamId),
      staffRole: normalizeRole(req.body?.staffRole || req.body?.role)
    });
    const enrichedAdmins = await enrichAdminsWithSteamProfiles(await listAdminsFromSupabase());
    const enrichedAdmin = enrichedAdmins.find((entry) => readText(entry?.steamId) === steamId) || admin;
    res.status(200).json({
      ok: true,
      admin: enrichedAdmin,
      admins: enrichedAdmins
    });
  } catch (error) {
    res.status(inferAdminErrorStatus(error, 404)).json({
      error: "admin_not_found",
      message: readText(error?.message, "Staff nao encontrado.")
    });
  }
}

async function handleDelete(req, res) {
  const viewer = await requireAdmin(req, res, {
    permission: "manageStaff",
    permissionMessage: "Seu cargo nao pode remover staffs."
  });
  if (!viewer) {
    return;
  }

  const steamId = getSteamIdFromRequest(req);
  if (!isValidSteamId(steamId)) {
    res.status(400).json({
      error: "invalid_steam_id",
      message: "SteamID invalido."
    });
    return;
  }

  try {
    const admins = await enrichAdminsWithSteamProfiles(await removeAdminInSupabase(steamId));
    res.status(200).json({
      ok: true,
      admins
    });
  } catch (error) {
    const status = inferAdminErrorStatus(error, 400);
    res.status(status).json({
      error: status === 404 ? "admin_not_found" : "remove_admin_failed",
      message: readText(error?.message, "Falha ao remover staff.")
    });
  }
}

export default async function handler(req, res) {
  if (req.method === "PATCH") {
    await handleUpdate(req, res);
    return;
  }
  if (req.method === "DELETE") {
    await handleDelete(req, res);
    return;
  }

  res.status(405).json({
    error: "method_not_allowed",
    message: "Metodo nao permitido."
  });
}
