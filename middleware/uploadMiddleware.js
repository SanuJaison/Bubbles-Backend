const path = require("path");
const multer = require("multer");

const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_WALLPAPER_BYTES = 10 * 1024 * 1024;
const MAX_CHAT_FILES = 10;

const IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
]);

const DOCUMENT_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
]);

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;
const AUDIO_EXTENSIONS = /\.(webm|ogg|oga|mp3|wav|m4a|mp4|aac|flac|opus)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|mkv|ogv|3gp)$/i;

const hasAllowedExtension = (file) => {
    const name = file.originalname || "";
    const mime = file.mimetype || "";

    if (mime.startsWith("image/")) {
        return IMAGE_EXTENSIONS.test(name);
    }

    if (mime.startsWith("audio/")) {
        return AUDIO_EXTENSIONS.test(name);
    }

    if (mime.startsWith("video/")) {
        return VIDEO_EXTENSIONS.test(name);
    }

    const extension = path.extname(name).toLowerCase();

    if (mime === "application/pdf") {
        return extension === ".pdf";
    }

    if (mime === "application/msword") {
        return extension === ".doc";
    }

    if (
        mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
        return extension === ".docx";
    }

    if (mime === "text/plain") {
        return extension === ".txt";
    }

    return false;
};

const createFileFilter = ({ imagesOnly = false } = {}) => (
    req,
    file,
    callback
) => {
    const mime = file.mimetype || "";

    const mimeAllowed = imagesOnly
        ? IMAGE_TYPES.has(mime)
        : IMAGE_TYPES.has(mime) ||
          DOCUMENT_TYPES.has(mime) ||
          mime.startsWith("audio/") ||
          mime.startsWith("video/");

    if (!mimeAllowed || !hasAllowedExtension(file)) {
        return callback(
            new multer.MulterError(
                "LIMIT_UNEXPECTED_FILE",
                file.fieldname
            ),
            false
        );
    }

    callback(null, true);
};

const memoryStorage = multer.memoryStorage();

const chatUploader = multer({
    storage: memoryStorage,
    fileFilter: createFileFilter(),
    limits: {
        fileSize: MAX_CHAT_FILE_BYTES,
        files: MAX_CHAT_FILES,
        fields: 20,
        parts: MAX_CHAT_FILES + 20,
        fieldSize: 100 * 1024,
        headerPairs: 100,
    },
});

const imageUploader = multer({
    storage: memoryStorage,
    fileFilter: createFileFilter({ imagesOnly: true }),
    limits: {
        fileSize: MAX_IMAGE_BYTES,
        files: 1,
        fields: 10,
        parts: 12,
        fieldSize: 100 * 1024,
        headerPairs: 100,
    },
});

const wallpaperUploader = multer({
    storage: memoryStorage,
    fileFilter: createFileFilter({ imagesOnly: true }),
    limits: {
        fileSize: MAX_WALLPAPER_BYTES,
        files: 1,
        fields: 10,
        parts: 12,
        fieldSize: 100 * 1024,
        headerPairs: 100,
    },
});

const wrapUpload = (middleware) => (req, res, next) => {
    middleware(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
                success: false,
                message: "That file is too large.",
            });
        }

        if (error.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({
                success: false,
                message: `You can attach up to ${MAX_CHAT_FILES} files at once.`,
            });
        }

        if (error.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({
                success: false,
                message: "That file type is not allowed.",
            });
        }

        return res.status(400).json({
            success: false,
            message: "Could not read the uploaded file.",
        });
    });
};

module.exports = {
    chatUpload: wrapUpload(chatUploader.array("files", MAX_CHAT_FILES)),
    profileUpload: wrapUpload(imageUploader.single("profilePicture")),
    wallpaperUpload: wrapUpload(wallpaperUploader.single("wallpaper")),
    groupAvatarUpload: wrapUpload(imageUploader.single("avatar")),
    MAX_CHAT_FILE_BYTES,
    MAX_IMAGE_BYTES,
    MAX_WALLPAPER_BYTES,
    MAX_CHAT_FILES,
};
