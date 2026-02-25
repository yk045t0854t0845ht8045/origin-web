// @ts-nocheck
const {
  buildViewerFromRequest,
  setAuthCookie,
  clearAuthCookie
} = require("./auth-core");

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

function hasPermission(viewer, permissionName) {
  return Boolean(viewer?.authenticated && viewer?.isAdmin && viewer?.permissions?.[permissionName]);
}

async function resolveViewer(req, res) {
  const viewer = await buildViewerFromRequest(req);
  if (viewer.authenticated && viewer.user?.steamId) {
    setAuthCookie(res, req, viewer.user);
  } else {
    clearAuthCookie(res, req);
  }
  return viewer;
}

async function requireAdmin(req, res, options = {}) {
  const viewer = await resolveViewer(req, res);
  if (!viewer.authenticated) {
    res.status(401).json({
      error: "not_authenticated",
      message: "Login obrigatorio."
    });
    return null;
  }
  if (viewer.adminError) {
    res.status(503).json({
      error: "admin_storage_unavailable",
      message: viewer.adminError
    });
    return null;
  }
  if (!viewer.isAdmin) {
    res.status(403).json({
      error: "forbidden",
      message: "Seu SteamID nao esta autorizado como administrador."
    });
    return null;
  }

  const neededPermission = readText(options.permission);
  if (neededPermission && !hasPermission(viewer, neededPermission)) {
    res.status(403).json({
      error: "forbidden_permission",
      message: readText(options.permissionMessage, "Voce nao tem permissao para esta acao.")
    });
    return null;
  }

  return {
    ...viewer,
    role: normalizeRole(viewer.role, "staff")
  };
}

module.exports = {
  requireAdmin,
  resolveViewer,
  normalizeRole
};

