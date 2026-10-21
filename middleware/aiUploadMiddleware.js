const multer = require("multer");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 30 * 1024 * 1024,
        files: 12,
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
                message: "Each file must be 30 MB or smaller",
            });
        }

        if (error.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({
                message: "You can attach up to 12 files at once",
            });
        }

        return res.status(400).json({
            message: error.message || "Could not read the uploaded files",
        });
    });
};

module.exports = {
    chatUpload: wrapUpload(upload.array("files", 12)),
    voiceUpload: wrapUpload(upload.single("file")),
};
