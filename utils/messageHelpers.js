const Chat = require("../models/chatModel");
const Message = require("../models/messageModel");
const { applyBlockSnapshots } = require("./blockHelpers");

const PARTICIPANT_FIELDS =
    "name username profilePicture bio isOnline lastSeen onlineStatus profilePhotoVisibility lastSeenVisibility blockedUsers blockedSnapshots";

// Fans a freshly created message out to everyone in the chat who is allowed to
// see it. Shared by the call log and the group system messages so they behave
// exactly like normal messages on every client.
const broadcastMessage = async (
    io,
    chatId,
    message,
    viewerId,
    invisibleIds = []
) => {
    if (!io) {
        return;
    }

    const populatedChat = await Chat.findById(chatId).populate(
        "participants",
        PARTICIPANT_FIELDS
    );

    if (!populatedChat) {
        return;
    }

    applyBlockSnapshots(populatedChat.participants, viewerId);

    populatedChat.participants
        .filter(
            (participant) =>
                !invisibleIds.includes(participant._id.toString())
        )
        .forEach((participant) => {
            io.to(`user:${participant._id.toString()}`).emit(
                "newMessage",
                {
                    message,
                    chat: populatedChat
                }
            );
        });
};

// Group activity ("Alice added Bob", "Carol changed the group name") shows up
// as an inline bubble instead of a notification.
const createSystemMessage = async (io, chatId, actorId, text) => {
    try {
        const message = await Message.create({
            chat: chatId,
            sender: actorId,
            text,
            messageType: "system"
        });

        await message.populate("sender", "name username profilePicture");

        const chat = await Chat.findById(chatId);

        if (chat) {
            chat.lastMessage = text;
            chat.lastMessageAt = new Date();
            chat.lastMessageSender = actorId;

            // New activity brings a deleted chat back for its members.
            chat.hiddenFor = [];

            await chat.save();
        }

        await broadcastMessage(io, chatId, message, actorId);

        return message;

    } catch (error) {
        console.error("Error creating system message:", error);
        return null;
    }
};

const buildCallPreview = (callType, status) => {
    const kind = callType === "video" ? "Video call" : "Voice call";

    if (status === "completed") {
        return kind;
    }

    if (status === "declined") {
        return `Declined ${kind.toLowerCase()}`;
    }

    if (status === "cancelled") {
        return `Cancelled ${kind.toLowerCase()}`;
    }

    return `Missed ${kind.toLowerCase()}`;
};

module.exports = {
    PARTICIPANT_FIELDS,
    broadcastMessage,
    createSystemMessage,
    buildCallPreview
};
