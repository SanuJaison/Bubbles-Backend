/**
 * The public origin of the web app, used to build links inside emails.
 *
 * PASSWORD_RESET_URL is checked first so a deployment can point reset links at
 * the desktop site even when the API is served from another host.
 */
const getClientOrigin = () => {
    const configured =
        process.env.PASSWORD_RESET_URL ||
        process.env.CLIENT_URLS ||
        process.env.CLIENT_URL ||
        "http://localhost:5173";
    const firstOrigin = String(configured)
        .split(",")[0]
        .trim()
        .replace(/\/+$/, "");

    try {
        return new URL(firstOrigin).origin;
    } catch {
        return "http://localhost:5173";
    }
};

module.exports = { getClientOrigin };
