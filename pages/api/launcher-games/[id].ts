// @ts-nocheck
const { requireAdmin } = require("../../../src/route-auth");
const { deleteLauncherGameInSupabase, readText } = require("../../../src/supabase-dashboard");
const { slugify } = require("../../../src/utils");

function getGameIdFromRequest(req) {
  const raw = req?.query?.id;
  if (Array.isArray(raw)) {
    return slugify(raw[0]);
  }
  return slugify(raw);
}

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  const viewer = await requireAdmin(req, res, {
    permission: "removeGame",
    permissionMessage: "Seu cargo nao pode remover jogos."
  });
  if (!viewer) {
    return;
  }

  const gameId = getGameIdFromRequest(req);
  if (!gameId) {
    res.status(400).json({
      error: "invalid_game_id",
      message: "ID de jogo invalido."
    });
    return;
  }

  try {
    const deleted = await deleteLauncherGameInSupabase(gameId);
    if (!deleted) {
      res.status(404).json({
        error: "game_not_found",
        message: "Jogo nao encontrado."
      });
      return;
    }
    res.status(200).json({
      ok: true,
      gameId
    });
  } catch (error) {
    res.status(502).json({
      error: "remove_launcher_game_failed",
      message: readText(error?.message, "Falha ao remover jogo.")
    });
  }
}

