const express = require("express");
const {
    getMe,
    getOverview,
    getUsers,
    getUser,
    getFeedback,
    updateFeedbackStatus,
} = require("../controllers/adminController");
const authMiddleware = require("../middleware/authMiddleware");
const { adminMiddleware } = require("../middleware/adminMiddleware");
const { objectIdParam } = require("../middleware/securityMiddleware");

const adminRoutes = express.Router();

adminRoutes.param("userId", objectIdParam("user"));
adminRoutes.param("feedbackId", objectIdParam("feedback"));

// Every admin request is a normal authenticated Bubbles session first. The
// email allow-list is the second gate, so a stolen user token cannot read the
// dashboard unless it belongs to the configured admin account.
adminRoutes.use(authMiddleware, adminMiddleware);

adminRoutes.get("/me", getMe);
adminRoutes.get("/overview", getOverview);
adminRoutes.get("/users", getUsers);
adminRoutes.get("/users/:userId", getUser);
adminRoutes.get("/feedback", getFeedback);
adminRoutes.patch("/feedback/:feedbackId", updateFeedbackStatus);

module.exports = adminRoutes;
