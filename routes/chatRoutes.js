const express = require("express");
const {
    createOrGetChat,
    getMyChats,
    deleteChat,
    createGroup,
    getChatById,
    updateGroup,
    addGroupMembers,
    removeGroupMember,
    setGroupAdmin,
    updateGroupPermissions,
    leaveGroup,
    deleteGroup,
    reportChat,
} = require("../controllers/chatController");
const authMiddleware = require("../middleware/authMiddleware");
const { groupAvatarUpload } = require("../middleware/uploadMiddleware");
const { uploadLimiter } = require("../middleware/rateLimiters");
const { objectIdParam, sanitizeRequest } = require("../middleware/securityMiddleware");

const chatRoutes = express.Router();

chatRoutes.param("chatId", objectIdParam("chat"));
chatRoutes.param("userId", objectIdParam("user"));

chatRoutes.post("/", authMiddleware, createOrGetChat);

chatRoutes.get("/", authMiddleware, getMyChats);

chatRoutes.post(
    "/group",
    authMiddleware,
    uploadLimiter,
    groupAvatarUpload,
    sanitizeRequest,
    createGroup
);

chatRoutes.get("/:chatId", authMiddleware, getChatById);

chatRoutes.patch(
    "/:chatId/group",
    authMiddleware,
    uploadLimiter,
    groupAvatarUpload,
    sanitizeRequest,
    updateGroup
);

chatRoutes.post("/:chatId/members", authMiddleware, addGroupMembers);

chatRoutes.delete(
    "/:chatId/members/:userId",
    authMiddleware,
    removeGroupMember
);

chatRoutes.patch(
    "/:chatId/members/:userId/admin",
    authMiddleware,
    setGroupAdmin
);

chatRoutes.patch(
    "/:chatId/permissions",
    authMiddleware,
    updateGroupPermissions
);

chatRoutes.post("/:chatId/leave", authMiddleware, leaveGroup);

chatRoutes.post("/:chatId/report", authMiddleware, reportChat);

chatRoutes.delete("/:chatId/group", authMiddleware, deleteGroup);

chatRoutes.delete("/:chatId", authMiddleware, deleteChat);

module.exports = chatRoutes;
