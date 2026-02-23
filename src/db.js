const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { slugify } = require("./utils");

function nowIso() {
  return new Date().toISOString();
}

function sanitizeStaffText(value, fallback = "") {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 80);
}

function normalizeStaffRole(value, fallback = "staff") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["developer", "dev", "super-admin", "super_admin", "superadmin", "owner", "root"].includes(normalized)) {
    return "developer";
  }
  if (
    [
      "administrador",
      "admin",
      "administrator",
      "administrador(a)",
      "moderator",
      "mod",
      "manager",
      "gerente"
    ].includes(normalized)
  ) {
    return "administrador";
  }
  return "staff";
}

function mapAdminRow(row) {
  if (!row) {
    return null;
  }
  return {
    steamId: row.steam_id,
    staffName: row.staff_name || "",
    staffRole: normalizeStaffRole(row.staff_role, "staff"),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

function mapGameRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    driveFolderId: row.drive_folder_id || "",
    archiveFileId: row.archive_file_id || "",
    archiveFileName: row.archive_file_name || "",
    archiveFileUrl: row.archive_file_url || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAdminPayload(input) {
  if (typeof input === "string") {
    return {
      steamId: String(input).trim(),
      staffName: "Staff",
      staffRole: "staff"
    };
  }

  const fallbackRole = normalizeStaffRole(
    input?.currentStaffRole || input?.current_staff_role || input?.fallbackRole || input?.fallback_role || "staff",
    "staff"
  );
  return {
    steamId: String(input?.steamId || "").trim(),
    staffName: sanitizeStaffText(input?.staffName || input?.name || "", "Staff"),
    staffRole: normalizeStaffRole(input?.staffRole || input?.role || "", fallbackRole)
  };
}

function initDatabase(config) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_steam_ids (
      steam_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      drive_folder_id TEXT DEFAULT '',
      archive_file_id TEXT DEFAULT '',
      archive_file_name TEXT DEFAULT '',
      archive_file_url TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const adminColumns = db.prepare("PRAGMA table_info(admin_steam_ids)").all();
  const adminColumnNames = new Set(adminColumns.map((column) => String(column.name)));
  if (!adminColumnNames.has("staff_name")) {
    db.exec("ALTER TABLE admin_steam_ids ADD COLUMN staff_name TEXT NOT NULL DEFAULT ''");
  }
  if (!adminColumnNames.has("staff_role")) {
    db.exec("ALTER TABLE admin_steam_ids ADD COLUMN staff_role TEXT NOT NULL DEFAULT 'staff'");
  }
  if (!adminColumnNames.has("updated_at")) {
    db.exec("ALTER TABLE admin_steam_ids ADD COLUMN updated_at TEXT");
    db.exec("UPDATE admin_steam_ids SET updated_at = created_at WHERE updated_at IS NULL");
  }
  db.exec("UPDATE admin_steam_ids SET staff_name = COALESCE(staff_name, '')");
  db.exec("UPDATE admin_steam_ids SET staff_role = COALESCE(staff_role, 'staff')");
  db.exec("UPDATE admin_steam_ids SET updated_at = COALESCE(updated_at, created_at)");

  const statements = {
    insertBootstrapAdmin: db.prepare(`
      INSERT OR IGNORE INTO admin_steam_ids (
        steam_id,
        staff_name,
        staff_role,
        created_at,
        updated_at
      )
      VALUES (
        @steamId,
        @staffName,
        @staffRole,
        @createdAt,
        @updatedAt
      )
    `),
    upsertAdmin: db.prepare(`
      INSERT INTO admin_steam_ids (
        steam_id,
        staff_name,
        staff_role,
        created_at,
        updated_at
      )
      VALUES (
        @steamId,
        @staffName,
        @staffRole,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(steam_id) DO UPDATE SET
        staff_name = excluded.staff_name,
        staff_role = excluded.staff_role,
        updated_at = excluded.updated_at
    `),
    upsertAdminSnapshot: db.prepare(`
      INSERT INTO admin_steam_ids (
        steam_id,
        staff_name,
        staff_role,
        created_at,
        updated_at
      )
      VALUES (
        @steamId,
        @staffName,
        @staffRole,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(steam_id) DO UPDATE SET
        staff_name = excluded.staff_name,
        staff_role = excluded.staff_role,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `),
    updateAdmin: db.prepare(`
      UPDATE admin_steam_ids
      SET
        staff_name = @staffName,
        staff_role = @staffRole,
        updated_at = @updatedAt
      WHERE steam_id = @steamId
    `),
    deleteAdmin: db.prepare(`
      DELETE FROM admin_steam_ids
      WHERE steam_id = @steamId
    `),
    clearAdmins: db.prepare(`
      DELETE FROM admin_steam_ids
    `),
    listAdmins: db.prepare(`
      SELECT
        steam_id,
        staff_name,
        staff_role,
        created_at,
        updated_at
      FROM admin_steam_ids
      ORDER BY created_at ASC
    `),
    findAdmin: db.prepare(`
      SELECT
        steam_id,
        staff_name,
        staff_role,
        created_at,
        updated_at
      FROM admin_steam_ids
      WHERE steam_id = @steamId
      LIMIT 1
    `),
    countAdmins: db.prepare(`
      SELECT COUNT(*) AS total
      FROM admin_steam_ids
    `),
    upsertGame: db.prepare(`
      INSERT INTO games (
        name,
        slug,
        description,
        created_at,
        updated_at
      )
      VALUES (
        @name,
        @slug,
        @description,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        updated_at = excluded.updated_at
    `),
    findGameBySlug: db.prepare(`
      SELECT *
      FROM games
      WHERE slug = @slug
      LIMIT 1
    `),
    listGames: db.prepare(`
      SELECT *
      FROM games
      ORDER BY created_at DESC
    `),
    setGameArchive: db.prepare(`
      UPDATE games
      SET
        drive_folder_id = @driveFolderId,
        archive_file_id = @archiveFileId,
        archive_file_name = @archiveFileName,
        archive_file_url = @archiveFileUrl,
        updated_at = @updatedAt
      WHERE slug = @slug
    `)
  };

  function bootstrapAdmins(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const timestamp = nowIso();
    for (const entry of list) {
      const normalized = normalizeAdminPayload(entry);
      if (!normalized.steamId) {
        continue;
      }
      statements.insertBootstrapAdmin.run({
        steamId: normalized.steamId,
        staffName: normalized.staffName,
        staffRole: normalized.staffRole,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }

  function listAdmins() {
    return statements.listAdmins.all().map(mapAdminRow);
  }

  function upsertAdminSnapshot(payload) {
    const normalized = normalizeAdminPayload(payload);
    if (!normalized.steamId) {
      return null;
    }
    const createdAt = String(payload?.createdAt || payload?.created_at || nowIso());
    const updatedAt = String(payload?.updatedAt || payload?.updated_at || createdAt);
    statements.upsertAdminSnapshot.run({
      steamId: normalized.steamId,
      staffName: normalized.staffName,
      staffRole: normalized.staffRole,
      createdAt,
      updatedAt
    });
    return getAdminBySteamId(normalized.steamId);
  }

  const replaceAdminsTransaction = db.transaction((entries) => {
    statements.clearAdmins.run();
    for (const entry of entries) {
      const normalized = normalizeAdminPayload(entry);
      if (!normalized.steamId) {
        continue;
      }
      const createdAt = String(entry?.createdAt || entry?.created_at || nowIso());
      const updatedAt = String(entry?.updatedAt || entry?.updated_at || createdAt);
      statements.upsertAdminSnapshot.run({
        steamId: normalized.steamId,
        staffName: normalized.staffName,
        staffRole: normalized.staffRole,
        createdAt,
        updatedAt
      });
    }
  });

  function replaceAdmins(entries) {
    const list = Array.isArray(entries) ? entries : [];
    replaceAdminsTransaction(list);
    return listAdmins();
  }

  function getAdminBySteamId(steamId) {
    return mapAdminRow(
      statements.findAdmin.get({
        steamId: String(steamId || "").trim()
      })
    );
  }

  function addAdmin(payload) {
    const normalized = normalizeAdminPayload(payload);
    if (!normalized.steamId) {
      throw new Error("SteamID invalido.");
    }
    const timestamp = nowIso();
    statements.upsertAdmin.run({
      steamId: normalized.steamId,
      staffName: normalized.staffName,
      staffRole: normalized.staffRole,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return getAdminBySteamId(normalized.steamId);
  }

  function updateAdmin(steamId, payload) {
    const currentAdmin = getAdminBySteamId(steamId);
    if (!currentAdmin) {
      throw new Error("Staff nao encontrado.");
    }

    const staffName = sanitizeStaffText(payload?.staffName || payload?.name || "", currentAdmin.staffName);
    const staffRole = sanitizeStaffText(
      payload?.staffRole || payload?.role || "",
      currentAdmin.staffRole
    );

    statements.updateAdmin.run({
      steamId: currentAdmin.steamId,
      staffName,
      staffRole: normalizeStaffRole(staffRole, currentAdmin.staffRole),
      updatedAt: nowIso()
    });

    return getAdminBySteamId(currentAdmin.steamId);
  }

  function removeAdmin(steamId) {
    statements.deleteAdmin.run({ steamId: String(steamId) });
    return listAdmins();
  }

  function countAdmins() {
    const row = statements.countAdmins.get();
    return Number(row?.total || 0);
  }

  function isAdmin(steamId) {
    if (!steamId) {
      return false;
    }
    return Boolean(statements.findAdmin.get({ steamId: String(steamId) }));
  }

  function getGameBySlug(slug) {
    const normalizedSlug = slugify(slug);
    if (!normalizedSlug) {
      return null;
    }
    const row = statements.findGameBySlug.get({ slug: normalizedSlug });
    return mapGameRow(row);
  }

  function listGames() {
    return statements.listGames.all().map(mapGameRow);
  }

  function upsertGame(payload) {
    const name = String(payload?.name || "").trim();
    const slugInput = String(payload?.slug || name);
    const slug = slugify(slugInput);
    const description = String(payload?.description || "").trim();
    if (!name || !slug) {
      throw new Error("Nome do jogo invalido.");
    }

    const now = nowIso();
    statements.upsertGame.run({
      name,
      slug,
      description,
      createdAt: now,
      updatedAt: now
    });

    return getGameBySlug(slug);
  }

  function setGameArchive(slug, uploadInfo) {
    const gameSlug = slugify(slug);
    if (!gameSlug) {
      throw new Error("Slug do jogo invalido.");
    }
    statements.setGameArchive.run({
      slug: gameSlug,
      driveFolderId: String(uploadInfo?.driveFolderId || ""),
      archiveFileId: String(uploadInfo?.archiveFileId || ""),
      archiveFileName: String(uploadInfo?.archiveFileName || "os.rar"),
      archiveFileUrl: String(uploadInfo?.archiveFileUrl || ""),
      updatedAt: nowIso()
    });
    return getGameBySlug(gameSlug);
  }

  function close() {
    db.close();
  }

  return {
    bootstrapAdmins,
    listAdmins,
    upsertAdminSnapshot,
    replaceAdmins,
    getAdminBySteamId,
    addAdmin,
    updateAdmin,
    removeAdmin,
    countAdmins,
    isAdmin,
    getGameBySlug,
    listGames,
    upsertGame,
    setGameArchive,
    close
  };
}

module.exports = {
  initDatabase
};
