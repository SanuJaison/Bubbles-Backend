const express = require("express");
const {
    registerUser,
    loginUser,
    googleAuth,
    getUserProfile,
    editUserProfile,
    updateChatWallpaper,
    changePassword,
    chooseUsername,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerification,
    updateUserSettings,
    toggleBlockUser,
    getAllUsers,
    reportUser,
} = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const {
    profileUpload,
    wallpaperUpload,
} = require("../middleware/uploadMiddleware");
const {
    authLimiter,
    registerLimiter,
    sensitiveLimiter,
    emailLimiter,
    resetLimiter,
    verifyLimiter,
    uploadLimiter,
} = require("../middleware/rateLimiters");
const { objectIdParam, sanitizeRequest } = require("../middleware/securityMiddleware");

const userRoutes = express.Router();

userRoutes.param("userId", objectIdParam("user"));

userRoutes.post("/register", registerLimiter, registerUser);

userRoutes.post("/login", authLimiter, loginUser);

userRoutes.post("/google", authLimiter, googleAuth);

userRoutes.post("/forgot-password", emailLimiter, forgotPassword);

userRoutes.post("/reset-password", resetLimiter, resetPassword);

userRoutes.post("/verify-email", verifyLimiter, verifyEmail);

userRoutes.post("/resend-verification", emailLimiter, resendVerification);

userRoutes.get("/profile", authMiddleware, getUserProfile);

userRoutes.patch(
    "/username",
    authMiddleware,
    sensitiveLimiter,
    chooseUsername
);

userRoutes.patch(
    "/profile",
    authMiddleware,
    uploadLimiter,
    profileUpload,
    sanitizeRequest,
    editUserProfile
);

userRoutes.patch(
    "/wallpaper",
    authMiddleware,
    uploadLimiter,
    wallpaperUpload,
    sanitizeRequest,
    updateChatWallpaper
);

userRoutes.patch("/settings", authMiddleware, updateUserSettings);

userRoutes.patch(
    "/password",
    authMiddleware,
    sensitiveLimiter,
    changePassword
);

userRoutes.patch(
    "/block/:userId",
    authMiddleware,
    sensitiveLimiter,
    toggleBlockUser
);

userRoutes.post(
    "/report/:userId",
    authMiddleware,
    sensitiveLimiter,
    reportUser
);

userRoutes.get("/all", authMiddleware, getAllUsers);

module.exports = userRoutes;
