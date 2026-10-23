const express = require("express");
const { submitFeedback } = require("../controllers/feedbackController");
const { feedbackLimiter } = require("../middleware/rateLimiters");

const feedbackRoutes = express.Router();

feedbackRoutes.post("/", feedbackLimiter, submitFeedback);

module.exports = feedbackRoutes;
