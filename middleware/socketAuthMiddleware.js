const jwt = require("jsonwebtoken");

const socketAuthMiddleware = (socket, next) => {
    try {
        const token = socket.handshake.auth.token;

        if (!token) {
            return next(new Error("Authentication token is required"));
        }

        const decodedToken = jwt.verify(
            token,
            process.env.JWT_TOKEN
        );

        socket.userId = decodedToken.userId;

        next();

    } catch (error) {
        next(new Error("Invalid or expired token"));
    }
};

module.exports = socketAuthMiddleware;