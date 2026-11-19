const crypto = require("crypto");
const { getClientOrigin } = require("./clientUrl");

const PASSWORD_RESET_MINUTES = Math.min(
    120,
    Math.max(5, Number(process.env.PASSWORD_RESET_MINUTES) || 30)
);

// Raw tokens only ever travel by email. The database keeps a SHA-256 digest,
// so a database leak cannot be used to reset anyone's password.
const hashToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

/**
 * Stores a fresh reset token on the user document. The caller saves the user.
 * Returns the raw token for the email link.
 */
const createPasswordResetToken = (user) => {
    const rawToken = crypto.randomBytes(32).toString("hex");

    user.passwordResetToken = hashToken(rawToken);
    user.passwordResetExpires = new Date(
        Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000
    );

    return rawToken;
};

const buildPasswordResetUrl = (rawToken) =>
    `${getClientOrigin()}/reset-password/${rawToken}`;

module.exports = {
    PASSWORD_RESET_MINUTES,
    hashToken,
    createPasswordResetToken,
    buildPasswordResetUrl,
};
