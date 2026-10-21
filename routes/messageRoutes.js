const express = require("express");
const { sendMessage, getChatMessages, markMessagesAsRead, markMessagesAsDelivered, togglePinMessage, deleteMessage, editMessage, forwardMessage, clearChat, logCall } = require("../controllers/messageController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const messageRoutes = express.Router();

messageRoutes.post("/", authMiddleware, upload.array("files"), sendMessage);

messageRoutes.post("/forward", authMiddleware, forwardMessage);

messageRoutes.post("/call-log", authMiddleware, logCall);

messageRoutes.get("/chat/:chatId", authMiddleware, getChatMessages);

messageRoutes.patch("/read/:chatId", authMiddleware, markMessagesAsRead);

messageRoutes.patch("/delivered/:chatId", authMiddleware, markMessagesAsDelivered);

messageRoutes.patch("/pin/:messageId", authMiddleware, togglePinMessage);

messageRoutes.delete("/chat/:chatId", authMiddleware, clearChat);

messageRoutes.delete("/:messageId", authMiddleware, deleteMessage);

messageRoutes.patch("/:messageId", authMiddleware, editMessage);

module.exports = messageRoutes;