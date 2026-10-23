const { normalizeEmail } = require("../utils/validation");

const extractEmail = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/<([^>]+)>/);
    const address = match ? match[1] : text;

    return normalizeEmail(address);
};

// ADMIN_EMAILS is the explicit setting. Falling back to SMTP_USER keeps a
// single-owner deployment working without another required environment
// variable, while still requiring a normal, verified Bubbles login.
const getAdminEmails = () => {
    const configured =
        process.env.ADMIN_EMAILS ||
        process.env.ADMIN_EMAIL ||
        process.env.SMTP_USER ||
        "";

    return Array.from(
        new Set(
            String(configured)
                .split(",")
                .map(extractEmail)
                .filter(Boolean)
        )
    );
};

const adminMiddleware = (req, res, next) => {
    const adminEmails = getAdminEmails();

    if (adminEmails.length === 0) {
        return res.status(503).json({
            success: false,
            code: "ADMIN_NOT_CONFIGURED",
            message:
                "Admin access is not configured. Add ADMIN_EMAILS to the backend environment.",
        });
    }

    const email = normalizeEmail(req.user?.email);

    if (!email || !adminEmails.includes(email)) {
        return res.status(403).json({
            success: false,
            code: "ADMIN_FORBIDDEN",
            message: "This Bubbles account does not have admin access.",
        });
    }

    req.adminEmail = email;

    next();
};

module.exports = {
    adminMiddleware,
    getAdminEmails,
};
