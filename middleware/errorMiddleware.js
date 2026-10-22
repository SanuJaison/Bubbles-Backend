const errorMiddleware = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    let statusCode = Number(err.statusCode || err.status) || 500;
    let message = "Something went wrong. Please try again.";

    if (err.code === "LIMIT_FILE_SIZE") {
        statusCode = 400;
        message = "That file is too large.";
    } else if (err.code === "LIMIT_FILE_COUNT") {
        statusCode = 400;
        message = "Too many files were attached.";
    } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
        statusCode = 400;
        message = "Unexpected file field.";
    } else if (err.type === "entity.too.large") {
        statusCode = 413;
        message = "The request body is too large.";
    } else if (err.type === "entity.parse.failed") {
        statusCode = 400;
        message = "The request body is not valid JSON.";
    } else if (err.name === "ValidationError") {
        statusCode = 400;
        message = "Some of the information provided is invalid.";
    } else if (err.name === "CastError") {
        statusCode = 400;
        message = "Invalid identifier.";
    } else if (err.code === 11000) {
        statusCode = 409;
        message = "That value is already in use.";
    } else if (statusCode >= 400 && statusCode < 500 && err.message) {
        message = err.message;
    }

    if (statusCode >= 500) {
        console.error(
            `[${req.method} ${req.originalUrl}]`,
            err.stack || err
        );
    }

    return res.status(statusCode).json({
        success: false,
        message,
    });
};

module.exports = errorMiddleware;
