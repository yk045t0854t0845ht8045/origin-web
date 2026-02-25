// @ts-nocheck
const { requireAdmin } = require("../../src/route-auth");
const {
  fetchLauncherGamesFromSupabase,
  getLauncherGamesCacheSnapshot,
  parsePositiveIntegerInput,
  readText
} = require("../../src/supabase-dashboard");

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

  try {
    const search = readText(req.query?.search);
    const limit = parsePositiveIntegerInput(req.query?.limit, 250);
    const games = await fetchLauncherGamesFromSupabase({ search, limit });
    res.status(200).json({
      ok: true,
      total: games.length,
      games
    });
  } catch (error) {
    const cache = getLauncherGamesCacheSnapshot();
    if (Array.isArray(cache.data) && cache.data.length > 0) {
      res.status(200).json({
        ok: true,
        total: cache.data.length,
        games: cache.data,
        stale: true,
        staleUpdatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : "",
        warning: "Supabase indisponivel no momento. Exibindo cache local."
      });
      return;
    }

    res.status(502).json({
      error: "list_launcher_games_failed",
      message: readText(error?.message, "Falha ao carregar catalogo no Supabase.")
    });
  }
}

