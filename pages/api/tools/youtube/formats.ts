// @ts-nocheck
const { requireAdmin } = require("../../../../src/route-auth");
const { getYoutubeFormatsForUrl } = require("../../../../src/youtube-downloader");

function readQueryText(value) {
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }
  return String(value ?? "").trim();
}

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

  const url = readQueryText(req.query?.url);
  if (!url) {
    res.status(400).json({
      error: "missing_url",
      message: "Cole um link do YouTube para listar as qualidades."
    });
    return;
  }

  try {
    const result = await getYoutubeFormatsForUrl(url);
    res.status(200).json({
      ok: true,
      video: {
        videoId: result.videoId,
        title: result.title,
        durationSeconds: result.durationSeconds,
        durationLabel: result.durationLabel,
        thumbnailUrl: result.thumbnailUrl
      },
      formats: result.formats
    });
  } catch (error) {
    const message = String(error?.message || "Falha ao ler qualidades do YouTube.");
    const status = message.toLowerCase().includes("inval") || message.toLowerCase().includes("selecione") ? 400 : 502;
    res.status(status).json({
      error: "youtube_formats_failed",
      message
    });
  }
}

