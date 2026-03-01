// @ts-nocheck
const { requireAdmin } = require("../../../src/route-auth");
const {
  MAINTENANCE_FLAG_ID,
  defaultMaintenanceFlag,
  fetchRuntimeFlagFromSupabase,
  upsertRuntimeFlagInSupabase,
  parseBooleanInput,
  parseObjectInput,
  normalizeMaintenanceVariantInput,
  readText
} = require("../../../src/supabase-dashboard");

async function handleGet(req, res) {
  const viewer = await requireAdmin(req, res);
  if (!viewer) {
    return;
  }

  try {
    const flag = (await fetchRuntimeFlagFromSupabase(MAINTENANCE_FLAG_ID)) || defaultMaintenanceFlag();
    res.status(200).json({
      ok: true,
      flag
    });
  } catch (error) {
    res.status(502).json({
      error: "maintenance_flag_load_failed",
      message: readText(error?.message, "Falha ao carregar flag de manutencao.")
    });
  }
}

async function handlePatch(req, res) {
  const viewer = await requireAdmin(req, res, {
    permission: "manageMaintenance",
    permissionMessage: "Seu cargo nao pode alterar o modo manutencao."
  });
  if (!viewer) {
    return;
  }

  try {
    const existingFlag = (await fetchRuntimeFlagFromSupabase(MAINTENANCE_FLAG_ID)) || defaultMaintenanceFlag();
    const existingData = parseObjectInput(existingFlag.data, {
      variant: normalizeMaintenanceVariantInput(existingFlag.variant, "alert")
    });
    const requestData = parseObjectInput(req.body?.data, existingData);
    const variant = normalizeMaintenanceVariantInput(
      req.body?.variant ??
        req.body?.bannerVariant ??
        req.body?.type ??
        req.body?.tone ??
        requestData.variant ??
        requestData.bannerVariant ??
        requestData.level,
      normalizeMaintenanceVariantInput(existingData.variant, "alert")
    );
    const payload = {
      id: MAINTENANCE_FLAG_ID,
      enabled: parseBooleanInput(req.body?.enabled, existingFlag.enabled),
      title: readText(req.body?.title, readText(existingFlag.title, defaultMaintenanceFlag().title)),
      message: readText(req.body?.message, readText(existingFlag.message, defaultMaintenanceFlag().message)),
      data: {
        ...existingData,
        ...requestData,
        variant
      }
    };

    const savedFlag = (await upsertRuntimeFlagInSupabase(payload)) || {
      ...defaultMaintenanceFlag(),
      ...payload
    };

    res.status(200).json({
      ok: true,
      flag: savedFlag
    });
  } catch (error) {
    res.status(502).json({
      error: "maintenance_flag_save_failed",
      message: readText(error?.message, "Falha ao salvar flag de manutencao.")
    });
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    await handleGet(req, res);
    return;
  }
  if (req.method === "PATCH") {
    await handlePatch(req, res);
    return;
  }

  res.status(405).json({
    error: "method_not_allowed",
    message: "Metodo nao permitido."
  });
}
