const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                message: "Authorization token is required",
            });
        }

        const token = authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).json({
                message: "Invalid authorization format",
            });
        }

        const decodedToken = jwt.verify(
            token,
            process.env.JWT_TOKEN
        );

        const user = await User.findById(decodedToken.userId).select("-password");

        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        req.user = user;

        next();
    } catch (error) {
        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({
                message: "Invalid token",
            });
        }

        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                message: "Token has expired",
            });
        }

        next(error);
    }
};

module.exports = authMiddleware;