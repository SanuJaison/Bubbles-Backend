const express = require("express");
const {
    chatWithAI,
    transcribeAudio,
} = require("../controllers/aiController");
const authMiddleware = require("../middleware/authMiddleware");
const { sanitizeRequest } = require("../middleware/securityMiddleware");
const {
    chatUpload,
    voiceUpload,
} = require("../middleware/aiUploadMiddleware");

const aiRoutes = express.Router();

aiRoutes.post("/chat", authMiddleware, chatUpload, sanitizeRequest, chatWithAI);

aiRoutes.post(
    "/transcribe",
    authMiddleware,
    voiceUpload,
    sanitizeRequest,
    transcribeAudio
);

module.exports = aiRoutes;
