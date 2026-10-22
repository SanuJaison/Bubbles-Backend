const mongoose = require("mongoose");

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Express' JSON parser turns `{"$gt": ""}` into a real object before our
// handlers ever see it. Strip Mongo operators, dotted paths and prototype
// pollution keys so user input can only ever be data.
const sanitizeValue = (value, depth = 0) => {
    if (depth > 12) {
        return null;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeValue(entry, depth + 1));
    }

    if (value && typeof value === "object") {
        const clean = {};

        for (const [key, entry] of Object.entries(value)) {
            if (
                FORBIDDEN_KEYS.has(key) ||
                key.startsWith("$") ||
                key.includes(".")
            ) {
                continue;
            }

            clean[key] = sanitizeValue(entry, depth + 1);
        }

        return clean;
    }

    return value;
};

const sanitizeRequest = (req, res, next) => {
    if (req.body && typeof req.body === "object") {
        req.body = sanitizeValue(req.body);
    }

    next();
};

const isObjectId = (value) =>
    typeof value === "string" && mongoose.isObjectIdOrHexString(value);

const objectIdParam = (name) => (req, res, next, value) => {
    if (!isObjectId(String(value || ""))) {
        return res.status(400).json({
            success: false,
            message: `Invalid ${name}`,
        });
    }

    next();
};

const noStore = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    next();
};

module.exports = {
    isObjectId,
    noStore,
    objectIdParam,
    sanitizeRequest,
    sanitizeValue,
};
