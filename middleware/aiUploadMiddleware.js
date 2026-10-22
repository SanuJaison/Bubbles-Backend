const multer = require("multer");

const MAX_AI_FILES = 8;
const MAX_AI_FILE_BYTES = 25 * 1024 * 1024;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_AI_FILE_BYTES,
        files: MAX_AI_FILES,
        fields: 10,
        parts: MAX_AI_FILES + 10,
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
                message: "Each file must be 25 MB or smaller",
            });
        }

        if (error.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({
                success: false,
                message: `You can attach up to ${MAX_AI_FILES} files at once`,
            });
        }

        return res.status(400).json({
            success: false,
            message: "Could not read the uploaded files",
        });
    });
};

module.exports = {
    chatUpload: wrapUpload(upload.array("files", MAX_AI_FILES)),
    voiceUpload: wrapUpload(upload.single("file")),
};
