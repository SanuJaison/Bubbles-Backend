const User = require("../models/userModel");
const { verifyAuthToken } = require("../utils/authTokens");
const { isObjectId } = require("./securityMiddleware");

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: "Authorization token is required",
            });
        }

        const match = /^Bearer\s+([^\s]+)$/i.exec(authHeader);

        if (!match) {
            return res.status(401).json({
                success: false,
                message: "Invalid authorization format",
            });
        }

        const decodedToken = verifyAuthToken(match[1]);

        if (!isObjectId(String(decodedToken.userId || ""))) {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
            });
        }

        const user = await User.findById(decodedToken.userId).select(
            "-password"
        );

        // A deleted account must not keep a valid session alive.
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Session is no longer valid",
            });
        }

        // Password changes bump the user's token version. Rejecting older
        // tokens signs out every other device without a session table.
        if (
            (Number(decodedToken.ver) || 0) !==
            (Number(user.tokenVersion) || 0)
        ) {
            return res.status(401).json({
                success: false,
                message: "Session is no longer valid",
            });
        }

        req.user = user;

        next();
    } catch (error) {
        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
            });
        }

        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token has expired",
            });
        }

        next(error);
    }
};

module.exports = authMiddleware;
