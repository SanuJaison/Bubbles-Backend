const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        chat: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Chat",
            required: true
        },

        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        text: {
            type: String,
            default: ""
        },

        replyTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Message",
            default: null
        },

        messageType: {
            type: String,
            enum: ["text", "image", "file", "audio", "call", "system"],
            default: "text"
        },

        // Voice/video call history. `status` decides how the bubble reads and
        // who gets the "missed" treatment.
        callInfo: {
            callType: {
                type: String,
                enum: ["audio", "video"],
                default: "audio"
            },
            status: {
                type: String,
                enum: ["completed", "missed", "declined", "cancelled"],
                default: "completed"
            },
            duration: {
                type: Number,
                default: 0
            }
        },

        files: [
            {
                url: {
                    type: String,
                    required: true
                },
                name: {
                    type: String,
                    required: true
                },
                mimeType: {
                    type: String,
                    required: true
                },
                size: {
                    type: Number,
                    required: true
                },
                // Only used by voice notes, so the bubble can show the
                // length before the audio metadata has loaded.
                duration: {
                    type: Number,
                    default: 0
                },
                // Normalised peaks (0..1) of the recording, so every client
                // draws the same waveform without decoding the audio.
                waveform: {
                    type: [Number],
                    default: []
                }
            }
        ],

        isDelivered: {
            type: Boolean,
            default: false
        },

        deliveredAt: {
            type: Date,
            default: null
        },

        isRead: {
            type: Boolean,
            default: false
        },

        readAt: {
            type: Date,
            default: null
        },

        isPinned: {
            type: Boolean,
            default: false
        },

        pinnedAt: {
            type: Date,
            default: null
        },

        pinnedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        isForwarded: {
            type: Boolean,
            default: false
        },

        isDeleted: {
            type: Boolean,
            default: false
        },

        isEdited: {
            type: Boolean,
            default: false
        },

        deletedAt: {
            type: Date,
            default: null
        },

        deletedFor: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            }
        ],

        // Recipients who had the sender blocked when this was written. They
        // never see it, never get it "delivered", and never get a preview.
        // Hidden from every query by default so the blocked person can't read
        // the field back and discover the block.
        blockedFor: {
            type: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User"
                }
            ],
            default: [],
            select: false
        }
    },
    {
        timestamps: true
    }
);

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;