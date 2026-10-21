const express = require("express");
const { registerUser, loginUser, getUserProfile, editUserProfile, updateChatWallpaper, changePassword, updateUserSettings, toggleBlockUser, getAllUsers, reportUser } = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const userRoutes = express.Router();

userRoutes.post("/register", registerUser);

userRoutes.post("/login", loginUser);

userRoutes.get("/profile", authMiddleware, getUserProfile);

userRoutes.patch("/profile", authMiddleware, upload.single("profilePicture"), editUserProfile);

userRoutes.patch("/wallpaper", authMiddleware, upload.single("wallpaper"), updateChatWallpaper);

userRoutes.patch("/settings", authMiddleware, updateUserSettings);

userRoutes.patch("/password", authMiddleware, changePassword);

userRoutes.patch("/block/:userId", authMiddleware, toggleBlockUser);

userRoutes.post("/report/:userId", authMiddleware, reportUser);

userRoutes.get("/all", authMiddleware, getAllUsers);

module.exports = userRoutes;