const express = require("express");
const {
    sendMessage,
    getChatMessages,
    markMessagesAsRead,
    markMessagesAsDelivered,
    togglePinMessage,
    deleteMessage,
    editMessage,
    forwardMessage,
    clearChat,
    logCall,
} = require("../controllers/messageController");
const authMiddleware = require("../middleware/authMiddleware");
const { chatUpload } = require("../middleware/uploadMiddleware");
const {
    messageLimiter,
    uploadLimiter,
} = require("../middleware/rateLimiters");
const { objectIdParam, sanitizeRequest } = require("../middleware/securityMiddleware");

const messageRoutes = express.Router();

messageRoutes.param("chatId", objectIdParam("chat"));
messageRoutes.param("messageId", objectIdParam("message"));

messageRoutes.post(
    "/",
    authMiddleware,
    uploadLimiter,
    messageLimiter,
    chatUpload,
    sanitizeRequest,
    sendMessage
);

messageRoutes.post(
    "/forward",
    authMiddleware,
    messageLimiter,
    forwardMessage
);

messageRoutes.post("/call-log", authMiddleware, messageLimiter, logCall);

messageRoutes.get("/chat/:chatId", authMiddleware, getChatMessages);

messageRoutes.patch("/read/:chatId", authMiddleware, markMessagesAsRead);

messageRoutes.patch(
    "/delivered/:chatId",
    authMiddleware,
    markMessagesAsDelivered
);

messageRoutes.patch("/pin/:messageId", authMiddleware, togglePinMessage);

messageRoutes.delete("/chat/:chatId", authMiddleware, clearChat);

messageRoutes.delete("/:messageId", authMiddleware, deleteMessage);

messageRoutes.patch("/:messageId", authMiddleware, editMessage);

module.exports = messageRoutes;
