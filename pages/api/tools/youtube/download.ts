// @ts-nocheck
const ytdl = require("@distube/ytdl-core");
const { requireAdmin } = require("../../../../src/route-auth");
const { resolveDownloadTarget } = require("../../../../src/youtube-downloader");

function readQueryText(value) {
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }
  return String(value ?? "").trim();
}

export const config = {
  api: {
    responseLimit: false
  }
};

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
  const itag = readQueryText(req.query?.itag);
  if (!url || !itag) {
    res.status(400).json({
      error: "missing_params",
      message: "Informe o link e a qualidade para baixar."
    });
    return;
  }

  try {
    const target = await resolveDownloadTarget(url, itag);
    const contentLength = Number(target?.format?.contentLength || 0);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename=\"${target.outputFileName}\"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    if (Number.isFinite(contentLength) && contentLength > 0) {
      res.setHeader("Content-Length", String(contentLength));
    }

    const stream = ytdl.downloadFromInfo(target.info, {
      quality: String(target.selectedItag),
      highWaterMark: 1 << 24
    });

    req.on("close", () => {
      stream.destroy();
    });

    stream.on("error", (error) => {
      if (!res.headersSent) {
        res.status(502).json({
          error: "youtube_download_failed",
          message: String(error?.message || "Falha no download do YouTube.")
        });
        return;
      }
      res.end();
    });

    stream.pipe(res);
  } catch (error) {
    const message = String(error?.message || "Falha no download do YouTube.");
    const lower = message.toLowerCase();
    const status =
      lower.includes("inval") || lower.includes("selecione")
        ? 400
        : lower.includes("429")
          ? 429
          : lower.includes("410")
            ? 503
            : 502;
    res.status(status).json({
      error: "youtube_download_failed",
      message
    });
  }
}
