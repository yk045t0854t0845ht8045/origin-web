// @ts-nocheck
const { buildViewerFromRequest, clearAuthCookie } = require("../../src/auth-core");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  try {
    const viewer = await buildViewerFromRequest(req);
    if (!viewer.authenticated) {
      clearAuthCookie(res, req);
    }
    res.status(200).json(viewer);
  } catch (error) {
    clearAuthCookie(res, req);
    res.status(200).json({
      authenticated: false,
      isAdmin: false,
      adminError: `Falha ao validar sessao: ${String(error?.message || "erro interno")}`,
      role: "",
      permissions: {
        manageStaff: false,
        publishGame: false,
        editGame: false,
        removeGame: false,
        manageMaintenance: false
      },
      user: null,
      steamLoginReady: false,
      steamLoginReason: "Erro interno no endpoint /api/me.",
      adminStorage: "local"
    });
  }
}
