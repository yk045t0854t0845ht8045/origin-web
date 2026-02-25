const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { google } = require("googleapis");
const { sanitizeDriveName } = require("./utils");

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
const DRIVE_SHARED_OPTIONS = {
  supportsAllDrives: true
};

function normalizeArchiveType(value) {
  const normalized = String(value || "rar")
    .trim()
    .toLowerCase();
  return normalized === "zip" ? "zip" : "rar";
}

function escapeQueryLiteral(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function parseServiceAccountFromInlineJson(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const normalizedRaw = raw.startsWith("base64:") ? Buffer.from(raw.slice(7), "base64").toString("utf8") : raw;
  try {
    const parsed = JSON.parse(normalizedRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON deve ser um objeto JSON.");
    }
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    if (!String(parsed.client_email || "").trim() || !String(parsed.private_key || "").trim()) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON precisa conter client_email e private_key.");
    }
    return parsed;
  } catch (_error) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON invalido. Informe JSON de Service Account (ou use prefixo base64:)."
    );
  }
}

function resolveKeyFilePath(config) {
  const rawInput = String(config.googleDriveKeyFile || "").trim();
  if (!rawInput) {
    return "";
  }
  const raw = rawInput.startsWith("~")
    ? path.join(process.env.USERPROFILE || process.env.HOME || "", rawInput.slice(1))
    : rawInput;
  if (!raw) {
    return "";
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(config.siteRoot, raw);
}

function resolveServiceAccountEmail(inlineCredentials, keyFilePath) {
  const inlineEmail = String(inlineCredentials?.client_email || "").trim();
  if (inlineEmail) {
    return inlineEmail;
  }

  if (keyFilePath && fs.existsSync(keyFilePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(keyFilePath, "utf8"));
      const keyEmail = String(parsed?.client_email || "").trim();
      if (keyEmail) {
        return keyEmail;
      }
    } catch (_error) {
      // Ignore read/parse errors, fallback below.
    }
  }

  return "";
}

function extractDriveApiErrorMessage(error) {
  const responseMessage = String(error?.response?.data?.error?.message || "").trim();
  if (responseMessage) {
    return responseMessage;
  }

  const detailMessage = String(error?.response?.data?.error?.errors?.[0]?.message || "").trim();
  if (detailMessage) {
    return detailMessage;
  }

  return String(error?.message || "Falha de comunicacao com Google Drive.").trim();
}

function mapDriveError(error, config) {
  const message = extractDriveApiErrorMessage(error);
  const lower = message.toLowerCase();
  const rootFolderId = String(config.googleDriveRootFolderId || "").trim();
  const serviceAccountEmail = String(config.googleDriveServiceAccountEmail || "").trim();
  const shareHint = serviceAccountEmail
    ? ` Compartilhe a pasta com ${serviceAccountEmail} como Editor.`
    : "";

  if (lower.includes("service accounts do not have storage quota")) {
    const hintRoot = rootFolderId === "root";
    return new Error(
      hintRoot
        ? "A Service Account nao possui quota no 'Meu Drive'. Use um Shared Drive e configure GOOGLE_DRIVE_ROOT_FOLDER_ID com o ID de uma pasta compartilhada com essa Service Account."
        : "A Service Account nao possui quota no 'Meu Drive'. Use uma pasta de Shared Drive (Google Workspace) no GOOGLE_DRIVE_ROOT_FOLDER_ID, ou OAuth de usuario."
    );
  }

  if (lower.includes("file not found") || lower.includes("not found")) {
    return new Error(
      `Pasta/arquivo do Google Drive nao encontrado. GOOGLE_DRIVE_ROOT_FOLDER_ID atual: ${rootFolderId || "(vazio)"}.${shareHint}`
    );
  }

  if (lower.includes("insufficient permissions") || lower.includes("permission denied")) {
    return new Error(
      `Permissao insuficiente no Google Drive.${shareHint || " Compartilhe a pasta com o client_email da Service Account com papel Editor."}`
    );
  }

  return new Error(message || "Falha no upload para Google Drive.");
}

function createDriveService(config) {
  let driveClientPromise = null;
  let rootAccessChecked = false;

  async function createDriveClient() {
    if (!config.googleDriveEnabled) {
      throw new Error("Google Drive desativado em GOOGLE_DRIVE_ENABLED.");
    }

    const inlineCredentials = parseServiceAccountFromInlineJson(config.googleServiceAccountJson);
    const keyFilePath = resolveKeyFilePath(config);
    const hasKeyFile = keyFilePath && fs.existsSync(keyFilePath);

    if (!inlineCredentials && keyFilePath && !hasKeyFile) {
      throw new Error(`GOOGLE_DRIVE_KEY_FILE aponta para arquivo inexistente: ${keyFilePath}`);
    }

    if (!inlineCredentials && !hasKeyFile) {
      throw new Error(
        "Configure GOOGLE_DRIVE_KEY_FILE ou GOOGLE_SERVICE_ACCOUNT_JSON para habilitar upload no Drive."
      );
    }
    config.googleDriveServiceAccountEmail = resolveServiceAccountEmail(inlineCredentials, keyFilePath);

    const auth = new google.auth.GoogleAuth({
      scopes: DRIVE_SCOPES,
      credentials: inlineCredentials || undefined,
      keyFile: hasKeyFile ? keyFilePath : undefined
    });

    return google.drive({
      version: "v3",
      auth
    });
  }

  async function getDriveClient() {
    if (!driveClientPromise) {
      driveClientPromise = createDriveClient().catch((error) => {
        driveClientPromise = null;
        throw error;
      });
    }
    return driveClientPromise;
  }

  async function findFolderByName(drive, parentId, folderName) {
    const escapedName = escapeQueryLiteral(folderName);
    const escapedParentId = escapeQueryLiteral(parentId);
    const query =
      `mimeType='${DRIVE_FOLDER_MIME}' and trashed=false and ` +
      `name='${escapedName}' and '${escapedParentId}' in parents`;

    const response = await drive.files.list({
      q: query,
      fields: "files(id,name)",
      pageSize: 1,
      includeItemsFromAllDrives: true,
      ...DRIVE_SHARED_OPTIONS
    });

    const list = Array.isArray(response.data?.files) ? response.data.files : [];
    return list[0] || null;
  }

  async function createFolder(drive, parentId, folderName) {
    const response = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: DRIVE_FOLDER_MIME,
        parents: [parentId]
      },
      fields: "id,name",
      ...DRIVE_SHARED_OPTIONS
    });
    return response.data;
  }

  async function ensureFolder(drive, parentId, folderName) {
    const existing = await findFolderByName(drive, parentId, folderName);
    if (existing?.id) {
      return existing.id;
    }
    const created = await createFolder(drive, parentId, folderName);
    return created.id;
  }

  async function ensureFolderPath(drive, rootId, segments) {
    let currentParentId = rootId;
    for (const rawSegment of segments) {
      const segment = sanitizeDriveName(rawSegment);
      if (!segment) {
        continue;
      }
      currentParentId = await ensureFolder(drive, currentParentId, segment);
    }
    return currentParentId;
  }

  async function ensureRootFolderAccessible(drive) {
    if (rootAccessChecked) {
      return;
    }
    const rootId = String(config.googleDriveRootFolderId || "").trim() || "root";
    if (rootId === "root") {
      rootAccessChecked = true;
      return;
    }

    try {
      await drive.files.get({
        fileId: rootId,
        fields: "id,name,mimeType,capabilities(canAddChildren,canEdit)",
        ...DRIVE_SHARED_OPTIONS
      });
      rootAccessChecked = true;
    } catch (error) {
      throw mapDriveError(error, config);
    }
  }

  async function setPublicReadPermission(drive, fileId) {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone"
      },
      ...DRIVE_SHARED_OPTIONS
    });
  }

  function resolvePrefixedFolderSegments(extraSegments = []) {
    const prefix = String(config.googleDrivePathPrefix || "")
      .split("/")
      .map((segment) => sanitizeDriveName(segment, ""))
      .filter(Boolean);
    const appended = (Array.isArray(extraSegments) ? extraSegments : [])
      .map((segment) => sanitizeDriveName(segment, ""))
      .filter(Boolean);
    return [...prefix, ...appended];
  }

  async function uploadGameArchive({ localFilePath, gameName, gameSlug, archiveType }) {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      throw new Error("Arquivo temporario de upload nao encontrado.");
    }

    try {
      const drive = await getDriveClient();
      await ensureRootFolderAccessible(drive);
      const normalizedArchiveType = normalizeArchiveType(archiveType);
      const gameFolder = sanitizeDriveName(gameName || gameSlug || "game");
      const folderSegments = resolvePrefixedFolderSegments([gameFolder]);

      const destinationFolderId = await ensureFolderPath(
        drive,
        config.googleDriveRootFolderId,
        folderSegments
      );

      const fileName = normalizedArchiveType === "zip" ? "os.zip" : "os.rar";
      const mimeType = normalizedArchiveType === "zip" ? "application/zip" : "application/vnd.rar";
      const uploadResponse = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [destinationFolderId]
        },
        media: {
          mimeType,
          body: fs.createReadStream(localFilePath)
        },
        fields: "id,name",
        ...DRIVE_SHARED_OPTIONS
      });

      const archiveFileId = String(uploadResponse.data?.id || "");
      if (!archiveFileId) {
        throw new Error("Falha ao criar arquivo no Google Drive.");
      }

      if (config.googleDrivePublicLink) {
        await setPublicReadPermission(drive, archiveFileId);
      }

      return {
        driveFolderId: destinationFolderId,
        driveFolderPath: folderSegments.join("/"),
        archiveFileId,
        archiveFileName: fileName,
        archiveType: normalizedArchiveType,
        archiveFileUrl: `https://drive.google.com/file/d/${archiveFileId}/view`
      };
    } catch (error) {
      throw mapDriveError(error, config);
    }
  }

  async function uploadFileBuffer({ buffer, fileName, mimeType = "application/octet-stream", folderSegments = [] }) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("Conteudo de arquivo invalido para upload.");
    }

    const sanitizedName = sanitizeDriveName(fileName || "arquivo");
    if (!sanitizedName) {
      throw new Error("Nome de arquivo invalido para upload.");
    }

    try {
      const drive = await getDriveClient();
      await ensureRootFolderAccessible(drive);
      const destinationPath = resolvePrefixedFolderSegments(folderSegments);
      const destinationFolderId = await ensureFolderPath(drive, config.googleDriveRootFolderId, destinationPath);

      const uploadResponse = await drive.files.create({
        requestBody: {
          name: sanitizedName,
          parents: [destinationFolderId]
        },
        media: {
          mimeType: String(mimeType || "application/octet-stream").trim() || "application/octet-stream",
          body: Readable.from(buffer)
        },
        fields: "id,name",
        ...DRIVE_SHARED_OPTIONS
      });

      const fileId = String(uploadResponse.data?.id || "");
      if (!fileId) {
        throw new Error("Falha ao criar arquivo no Google Drive.");
      }

      if (config.googleDrivePublicLink) {
        await setPublicReadPermission(drive, fileId);
      }

      return {
        fileId,
        fileName: sanitizedName,
        folderPath: destinationPath.join("/"),
        viewUrl: `https://drive.google.com/file/d/${fileId}/view`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
        publicUrl: config.googleDrivePublicLink ? `https://drive.google.com/uc?export=view&id=${fileId}` : ""
      };
    } catch (error) {
      throw mapDriveError(error, config);
    }
  }

  return {
    uploadGameArchive,
    uploadFileBuffer
  };
}

module.exports = {
  createDriveService
};
