// @ts-nocheck
const { requireAdmin } = require("../../src/route-auth");
const {
  fetchLauncherGamesFromSupabase,
  getLauncherGamesCacheSnapshot,
  parsePositiveIntegerInput,
  readText,
  updateLauncherGamesSortOrderInSupabase
} = require("../../src/supabase-dashboard");

function normalizeOrderedIdsPayload(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.orderedIds)
      ? value.orderedIds
      : Array.isArray(value?.ids)
        ? value.ids
        : [];
  const deduped = [];
  const seen = new Set();
  for (const entry of source) {
    const id = readText(entry).toLowerCase();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(id);
  }
  return deduped;
}

function escapeSqlLiteral(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function buildSortOrderUpdateSql(orderedIds = []) {
  const values = orderedIds
    .map((id, index) => `('${escapeSqlLiteral(id)}', ${(index + 1) * 10})`)
    .join(",\n  ");
  if (!values) {
    return "";
  }
  return [
    "update public.launcher_games as lg",
    "set sort_order = v.sort_order",
    "from (values",
    `  ${values}`,
    ") as v(id, sort_order)",
    "where lg.id = v.id;"
  ].join("\n");
}

async function handleListLauncherGames(req, res) {
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

async function handleReorderLauncherGames(req, res) {
  const viewer = await requireAdmin(req, res, {
    permission: "editGame",
    permissionMessage: "Seu cargo nao pode reorganizar jogos."
  });
  if (!viewer) {
    return;
  }

  const orderedIds = normalizeOrderedIdsPayload(req.body);
  if (orderedIds.length === 0) {
    res.status(400).json({
      error: "invalid_order_payload",
      message: "Envie orderedIds com pelo menos um ID valido."
    });
    return;
  }

  try {
    const currentGames = await fetchLauncherGamesFromSupabase({ limit: 500 });
    const currentById = new Map(
      (Array.isArray(currentGames) ? currentGames : []).map((game) => [readText(game?.id).toLowerCase(), game])
    );

    const missingIds = orderedIds.filter((id) => !currentById.has(id));
    if (missingIds.length > 0) {
      res.status(400).json({
        error: "unknown_game_id",
        message: `IDs de jogo invalidos na ordenacao: ${missingIds.join(", ")}`
      });
      return;
    }

    const orderedSet = new Set(orderedIds);
    const finalOrderIds = [
      ...orderedIds,
      ...currentGames
        .map((game) => readText(game?.id).toLowerCase())
        .filter((id) => id && !orderedSet.has(id))
    ];
    const sortOrderSql = buildSortOrderUpdateSql(finalOrderIds);
    const updates = finalOrderIds.map((id, index) => ({
      id,
      sort_order: (index + 1) * 10
    }));
    const changedUpdates = updates.filter((entry) => {
      const current = currentById.get(entry.id);
      const currentSortOrder = Number(current?.sort_order);
      return !Number.isFinite(currentSortOrder) || currentSortOrder !== entry.sort_order;
    });

    if (changedUpdates.length === 0) {
      res.status(200).json({
        ok: true,
        updated: 0,
        total: currentGames.length,
        games: currentGames,
        sql: sortOrderSql
      });
      return;
    }

    const games = await updateLauncherGamesSortOrderInSupabase(changedUpdates);
    res.status(200).json({
      ok: true,
      updated: changedUpdates.length,
      total: Array.isArray(games) ? games.length : 0,
      games: Array.isArray(games) ? games : [],
      sql: sortOrderSql
    });
  } catch (error) {
    res.status(502).json({
      error: "reorder_launcher_games_failed",
      message: readText(error?.message, "Falha ao atualizar ordem dos jogos.")
    });
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    await handleListLauncherGames(req, res);
    return;
  }

  if (req.method === "PATCH") {
    await handleReorderLauncherGames(req, res);
    return;
  }

  res.status(405).json({
    error: "method_not_allowed",
    message: "Metodo nao permitido."
  });
}
