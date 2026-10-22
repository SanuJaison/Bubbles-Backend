const jwt = require("jsonwebtoken");

const TOKEN_ISSUER = "bubbles";
const TOKEN_AUDIENCE = "bubbles-app";
const MIN_SECRET_LENGTH = 32;

const getJwtSecret = () => {
    const secret = process.env.JWT_TOKEN || "";

    if (secret.length < MIN_SECRET_LENGTH) {
        throw new Error(
            `JWT_TOKEN must be at least ${MIN_SECRET_LENGTH} characters long`
        );
    }

    return secret;
};

const assertSecureConfig = () => {
    getJwtSecret();

    if (!process.env.MONGODB_URL) {
        throw new Error("MONGODB_URL is required");
    }
};

const signAuthToken = (userId, tokenVersion = 0) =>
    jwt.sign(
        {
            userId: String(userId),
            ver: Number(tokenVersion) || 0,
        },
        getJwtSecret(),
        {
            algorithm: "HS256",
            expiresIn: process.env.JWT_EXPIRES_IN || "2d",
            issuer: TOKEN_ISSUER,
            audience: TOKEN_AUDIENCE,
        }
    );

const verifyAuthToken = (token) =>
    jwt.verify(token, getJwtSecret(), {
        algorithms: ["HS256"],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
    });

module.exports = {
    assertSecureConfig,
    signAuthToken,
    verifyAuthToken,
    TOKEN_ISSUER,
    TOKEN_AUDIENCE,
    MIN_SECRET_LENGTH,
};
