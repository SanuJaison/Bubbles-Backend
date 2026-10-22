const User = require("../models/userModel");
const { verifyAuthToken } = require("../utils/authTokens");
const { isObjectId } = require("./securityMiddleware");

const socketAuthMiddleware = async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token || typeof token !== "string") {
            return next(new Error("Authentication token is required"));
        }

        const decodedToken = verifyAuthToken(token);

        if (!isObjectId(String(decodedToken.userId || ""))) {
            return next(new Error("Invalid or expired token"));
        }

        const user = await User.findById(decodedToken.userId).select(
            "_id tokenVersion"
        );

        if (!user) {
            return next(new Error("Session is no longer valid"));
        }

        if (
            (Number(decodedToken.ver) || 0) !==
            (Number(user.tokenVersion) || 0)
        ) {
            return next(new Error("Session is no longer valid"));
        }

        socket.userId = user._id;

        next();
    } catch (error) {
        next(new Error("Invalid or expired token"));
    }
};

module.exports = socketAuthMiddleware;
