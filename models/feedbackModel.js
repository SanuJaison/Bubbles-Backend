const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            trim: true,
            maxlength: 80,
            default: "",
        },

        email: {
            type: String,
            trim: true,
            lowercase: true,
            maxlength: 254,
            default: "",
        },

        category: {
            type: String,
            enum: ["suggestion", "bug", "feature", "other"],
            default: "suggestion",
        },

        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000,
        },

        // The page the feedback was sent from, so future in-app forms can
        // point back to the exact screen that prompted the message.
        page: {
            type: String,
            trim: true,
            maxlength: 300,
            default: "",
        },

        source: {
            type: String,
            enum: ["web", "android", "windows"],
            default: "web",
        },

        status: {
            type: String,
            enum: ["new", "reviewed", "archived"],
            default: "new",
        },
    },
    { timestamps: true }
);

feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Feedback", feedbackSchema);
