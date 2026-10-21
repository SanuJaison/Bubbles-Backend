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
    reportChat
} = require("../controllers/chatController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const chatRoutes = express.Router();

chatRoutes.post("/", authMiddleware, createOrGetChat);

chatRoutes.get("/", authMiddleware, getMyChats);

chatRoutes.post(
    "/group",
    authMiddleware,
    upload.single("avatar"),
    createGroup
);

chatRoutes.get("/:chatId", authMiddleware, getChatById);

chatRoutes.patch(
    "/:chatId/group",
    authMiddleware,
    upload.single("avatar"),
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
