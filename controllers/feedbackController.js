const Feedback = require("../models/feedbackModel");
const { sendFeedbackNotificationEmail } = require("../utils/mailer");
const {
    asTrimmedString,
    stripControlChars,
    normalizeEmail,
    isValidEmail,
} = require("../utils/validation");

const CATEGORIES = new Set(["suggestion", "bug", "feature", "other"]);
const SOURCES = new Set(["web", "android", "windows"]);

const MAX_MESSAGE_LENGTH = 2000;
const MIN_MESSAGE_LENGTH = 5;

// Keep line breaks in the message, but drop control characters that could
// break an email client or a future admin view.
const stripUnsafeMultilineChars = (value) =>
    asTrimmedString(value).replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
        ""
    );

exports.submitFeedback = async (req, res, next) => {
    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};

        // Honeypot field: real people never see or fill this. Pretend the
        // submission worked so bots do not learn that they were filtered.
        if (asTrimmedString(body.website)) {
            return res.status(201).json({
                success: true,
                message: "Thanks for the feedback. It helps make Bubbles better.",
            });
        }

        const name = stripControlChars(body.name).slice(0, 80);
        const email = normalizeEmail(body.email);
        const rawCategory = asTrimmedString(body.category).toLowerCase();
        const rawSource = asTrimmedString(body.source).toLowerCase();
        const page = stripControlChars(body.page).slice(0, 300);
        const message = stripUnsafeMultilineChars(body.message);
        const category = rawCategory || "suggestion";
        const source = SOURCES.has(rawSource) ? rawSource : "web";

        if (!CATEGORIES.has(category)) {
            return res.status(400).json({
                success: false,
                message: "Please choose a valid feedback category.",
            });
        }

        if (message.length < MIN_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                message:
                    "Please add a little more detail so we can understand your feedback.",
            });
        }

        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Please keep your feedback under ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`,
            });
        }

        if (email && !isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message:
                    "Please enter a valid email address, or leave it blank.",
            });
        }

        const feedback = await Feedback.create({
            name,
            email,
            category,
            message,
            page,
            source,
        });

        // The message is already saved. A mail outage should never make the
        // sender think their feedback was lost.
        sendFeedbackNotificationEmail({
            name,
            email,
            category,
            message,
            page,
            source,
            createdAt: feedback.createdAt,
        }).catch((error) => {
            console.error(
                "Feedback notification email failed:",
                error.message
            );
        });

        return res.status(201).json({
            success: true,
            message: "Thanks for the feedback. It helps make Bubbles better.",
        });
    } catch (error) {
        return next(error);
    }
};
