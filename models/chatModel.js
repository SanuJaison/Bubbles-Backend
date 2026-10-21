const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
    {
        participants: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                required: true
            }
        ],

        isGroup: {
            type: Boolean,
            default: false
        },

        groupName: {
            type: String,
            trim: true,
            default: ""
        },

        groupAvatar: {
            type: String,
            default: ""
        },

        groupDescription: {
            type: String,
            trim: true,
            default: ""
        },

        // Who can administer the group. The creator is always one of these.
        groupAdmins: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            }
        ],

        groupCreatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        // Privileges the admins hand out to everyone else.
        groupPermissions: {
            sendMessages: {
                type: String,
                enum: ["all", "admins"],
                default: "all"
            },
            addMembers: {
                type: String,
                enum: ["all", "admins"],
                default: "all"
            },
            editInfo: {
                type: String,
                enum: ["all", "admins"],
                default: "admins"
            }
        },

        lastMessage: {
            type: String,
            default: ""
        },

        // Who wrote the preview above — group lists show "Alice: hi".
        lastMessageSender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        lastMessageAt: {
            type: Date,
            default: null
        },

        // Chats a user deleted from their list — reappear when a new
        // message arrives.
        hiddenFor: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            }
        ]
    },
    {
        timestamps: true
    }
);

const Chat = mongoose.model("Chat", chatSchema);

module.exports = Chat;
