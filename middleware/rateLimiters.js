const { rateLimit } = require("express-rate-limit");

const jsonLimitHandler = (message) => (req, res) => {
    res.status(429).json({
        success: false,
        message,
    });
};

const common = {
    standardHeaders: true,
    legacyHeaders: false,
    // Responses can contain personal data; never let a proxy cache them.
    skip: (req) => req.method === "OPTIONS",
};

const apiLimiter = rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 600,
    handler: jsonLimitHandler(
        "Too many requests were made from this connection. Please try again shortly."
    ),
});

const authLimiter = rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 12,
    skipSuccessfulRequests: true,
    handler: jsonLimitHandler(
        "Too many sign-in attempts. Please wait a few minutes and try again."
    ),
});

const registerLimiter = rateLimit({
    ...common,
    windowMs: 60 * 60 * 1000,
    limit: 10,
    handler: jsonLimitHandler(
        "Too many accounts were created from this connection. Please try again later."
    ),
});

const sensitiveLimiter = rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 30,
    handler: jsonLimitHandler(
        "Too many account changes were requested. Please slow down and try again."
    ),
});

const emailLimiter = rateLimit({
    ...common,
    windowMs: 60 * 60 * 1000,
    limit: 5,
    handler: jsonLimitHandler(
        "Too many reset emails were requested. Please wait and try again."
    ),
});

const resetLimiter = rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    handler: jsonLimitHandler(
        "Too many password reset attempts. Please wait a few minutes and try again."
    ),
});

const verifyLimiter = rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    handler: jsonLimitHandler(
        "Too many verification attempts. Please wait a few minutes and try again."
    ),
});

const messageLimiter = rateLimit({
    ...common,
    windowMs: 60 * 1000,
    limit: 120,
    handler: jsonLimitHandler(
        "You're sending messages too quickly. Give it a moment and try again."
    ),
});

const uploadLimiter = rateLimit({
    ...common,
    windowMs: 10 * 60 * 1000,
    limit: 60,
    handler: jsonLimitHandler(
        "Too many file uploads. Please wait a moment and try again."
    ),
});

const feedbackLimiter = rateLimit({
    ...common,
    windowMs: 60 * 60 * 1000,
    limit: 10,
    handler: jsonLimitHandler(
        "Too many feedback messages were sent from this connection. Please try again later."
    ),
});

module.exports = {
    apiLimiter,
    authLimiter,
    registerLimiter,
    sensitiveLimiter,
    emailLimiter,
    resetLimiter,
    verifyLimiter,
    messageLimiter,
    uploadLimiter,
    feedbackLimiter,
};
