// @ts-nocheck
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { requireAdmin } = require("../../src/route-auth");
const runtimeConfig = require("../../src/config");
const { createDriveService } = require("../../src/drive");
const { slugify } = require("../../src/utils");

const MAX_GALLERY_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];
const MAX_GALLERY_FILES = 12;

const driveService = createDriveService(runtimeConfig);

const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_GALLERY_IMAGE_UPLOAD_BYTES,
    files: MAX_GALLERY_FILES
  },
  fileFilter: (_req, file, callback) => {
    if (!normalizeImageExtension(file)) {
      callback(new Error("Somente imagens .png, .jpg, .jpeg, .webp, .gif ou .avif sao aceitas."));
      return;
    }
    callback(null, true);
  }
});

function runMiddleware(req, res, middleware) {
  return new Promise((resolve, reject) => {
    middleware(req, res, (result) => {
      if (result instanceof Error) {
        reject(result);
        return;
      }
      resolve(result);
    });
  });
}

function readText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeImageExtension(file) {
  const originalExt = path.extname(String(file?.originalname || "")).toLowerCase();
  if (ALLOWED_IMAGE_EXTENSIONS.includes(originalExt)) {
    return originalExt === ".jpeg" ? ".jpg" : originalExt;
  }

  const mime = String(file?.mimetype || "").toLowerCase();
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/avif") return ".avif";
  return "";
}

function buildGalleryFileName(originalName, extension) {
  const baseName = path.basename(String(originalName || "imagem"), path.extname(String(originalName || "")));
  const safeName = slugify(baseName) || "imagem";
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${uniqueId}-${safeName}${extension}`;
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  const viewer = await requireAdmin(req, res, {
    permission: "publishGame",
    permissionMessage: "Seu cargo nao pode enviar midias de jogo."
  });
  if (!viewer) {
    return;
  }

  try {
    await runMiddleware(req, res, galleryUpload.array("images", MAX_GALLERY_FILES));
  } catch (error) {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "image_too_large",
        message: "Cada imagem deve ter no maximo 5MB."
      });
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
      res.status(413).json({
        error: "too_many_images",
        message: `Envie no maximo ${MAX_GALLERY_FILES} imagens por vez.`
      });
      return;
    }

    res.status(400).json({
      error: "invalid_image_upload",
      message: String(error?.message || "Falha no upload das imagens.")
    });
    return;
  }

  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      res.status(400).json({
        error: "missing_images",
        message: "Selecione ao menos uma imagem para upload."
      });
      return;
    }

    const urls = [];
    const hasDriveCredentials = Boolean(
      readText(runtimeConfig.googleServiceAccountJson) || readText(runtimeConfig.googleDriveKeyFile)
    );
    const canUseDriveUpload =
      Boolean(runtimeConfig.googleDriveEnabled) &&
      hasDriveCredentials &&
      typeof driveService.uploadFileBuffer === "function";

    const localPublicGalleryDir = path.join(runtimeConfig.siteRoot, "public", "uploads", "gallery");
    if (!canUseDriveUpload) {
      fs.mkdirSync(localPublicGalleryDir, { recursive: true });
    }

    for (const file of files) {
      const extension = normalizeImageExtension(file);
      if (!extension || !file.buffer) {
        continue;
      }

      const fileName = buildGalleryFileName(file.originalname, extension);
      if (canUseDriveUpload) {
        const uploaded = await driveService.uploadFileBuffer({
          buffer: file.buffer,
          fileName,
          mimeType: String(file.mimetype || "").trim() || undefined,
          folderSegments: ["gallery-images"]
        });
        const uploadedUrl = readText(uploaded?.publicUrl || uploaded?.viewUrl || uploaded?.downloadUrl);
        if (uploadedUrl) {
          urls.push(uploadedUrl);
        }
        continue;
      }

      const destination = path.join(localPublicGalleryDir, fileName);
      fs.writeFileSync(destination, file.buffer);
      urls.push(`/uploads/gallery/${encodeURIComponent(fileName)}`);
    }

    if (urls.length === 0) {
      res.status(400).json({
        error: "invalid_images",
        message: "Nao foi possivel processar as imagens enviadas."
      });
      return;
    }

    res.status(200).json({
      ok: true,
      urls
    });
  } catch (error) {
    const message = String(error?.message || "Falha ao salvar imagens da galeria.");
    const status = message.toLowerCase().includes("permiss") || message.toLowerCase().includes("drive") ? 502 : 500;
    res.status(status).json({
      error: "image_upload_failed",
      message
    });
  }
}
