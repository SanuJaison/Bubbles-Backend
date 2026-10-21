const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
    {
        reporter: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        reportedUser: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        // The conversation the report came from, when there is one. Reports
        // can also be filed straight from a profile panel.
        chat: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Chat",
            default: null,
        },

        reason: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },

        details: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: "",
        },

        status: {
            type: String,
            enum: ["open", "reviewed", "dismissed"],
            default: "open",
        },
    },
    { timestamps: true }
);

// A user's own reports are the only ones they ever read back, and the most
// recent one matters most for rate limiting / duplicate checks.
reportSchema.index({ reporter: 1, reportedUser: 1, createdAt: -1 });

module.exports = mongoose.model("Report", reportSchema);
