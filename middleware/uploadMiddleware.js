const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, callback) => {
    const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain"
    ];

    if (
        allowedTypes.includes(file.mimetype) ||
        file.mimetype.startsWith("video/") ||
        file.mimetype.startsWith("audio/")
    ) {
        callback(null, true);
    } else {
        callback(new Error("This file type is not allowed"), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

module.exports = upload;