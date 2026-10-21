const express = require("express");
const {
    chatWithAI,
    transcribeAudio,
} = require("../controllers/aiController");
const authMiddleware = require("../middleware/authMiddleware");
const {
    chatUpload,
    voiceUpload,
} = require("../middleware/aiUploadMiddleware");

const aiRoutes = express.Router();

aiRoutes.post("/chat", authMiddleware, chatUpload, chatWithAI);

aiRoutes.post("/transcribe", authMiddleware, voiceUpload, transcribeAudio);

module.exports = aiRoutes;
