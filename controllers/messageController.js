const Message = require("../models/messageModel");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const cloudinary = require("../config/cloudinary");
const { applyBlockSnapshots } = require("../utils/blockHelpers");
const {
    broadcastMessage,
    buildCallPreview
} = require("../utils/messageHelpers");
const { isObjectId } = require("../middleware/securityMiddleware");
const { stripControlChars } = require("../utils/validation");

const MAX_MESSAGE_LENGTH = 10000;
const MAX_FORWARD_TARGETS = 20;

// Reaction users are populated for the client, but only the public profile
// fields belong in the response. Mongoose keeps `select: true` fields (like
// tokenVersion) in projections, so strip them explicitly here.
const serializeReactions = (reactions) =>
    (Array.isArray(reactions) ? reactions : []).map((reaction) => {
        const value =
            typeof reaction.toObject === "function"
                ? reaction.toObject()
                : reaction;
        const user = value.user;

        return {
            _id: value._id,
            emoji: value.emoji,
            createdAt: value.createdAt,
            user:
                user && typeof user === "object"
                    ? {
                          _id: user._id,
                          name: user.name,
                          username: user.username,
                          profilePicture: user.profilePicture
                      }
                    : user
        };
    });

// Who in this chat has the sender blocked? Those people must never see the
// message, so it is stored with them in `blockedFor` and treated as unsent.
const getBlockedByUserIds = async (chat, sender) => {
    const senderId = sender._id.toString();

    const otherParticipantIds = chat.participants
        .map((participant) => participant.toString())
        .filter(
            (participantId) => participantId !== senderId
        );

    if (otherParticipantIds.length === 0) {
        return {
            blockedByUserIds: [],
            blockedBySenderIds: [],
            senderBlockedThem: false
        };
    }

    const otherUsers = await User.find({
        _id: { $in: otherParticipantIds }
    }).select("blockedUsers");

    const senderBlockedIds = (sender.blockedUsers || []).map(
        (blockedUserId) => blockedUserId.toString()
    );

    const blockedBySenderIds = otherUsers
        .filter((otherUser) =>
            senderBlockedIds.includes(otherUser._id.toString())
        )
        .map((otherUser) => otherUser._id.toString());

    const senderBlockedThem = blockedBySenderIds.length > 0;

    const blockedByUserIds = otherUsers
        .filter((otherUser) =>
            (otherUser.blockedUsers || []).some(
                (blockedUserId) =>
                    blockedUserId.toString() === senderId
            )
        )
        .map((otherUser) => otherUser._id.toString());

    return {
        blockedByUserIds,
        blockedBySenderIds,
        senderBlockedThem
    };
};

exports.sendMessage = async (req, res, next) => {
    try {
        const { chatId: rawChatId, text, replyTo, duration, waveform } =
            req.body;
        const chatId = String(rawChatId || "");
        const uploadedFiles = req.files || [];
        const messageText =
            typeof text === "string"
                ? text.replace(/\u0000/g, "").trim()
                : "";

        if (!isObjectId(chatId)) {
            return res.status(400).json({
                success: false,
                message: "A valid chat is required"
            });
        }

        if (messageText.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer`
            });
        }

        if (!messageText && uploadedFiles.length === 0) {
            return res.status(400).json({
                success: false,
                message: "A message or at least one file is required"
            });
        }

        if (uploadedFiles.length > 10) {
            return res.status(400).json({
                success: false,
                message: "You can attach up to 10 files at once"
            });
        }

        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        let replyToId = null;

        if (replyTo !== undefined && replyTo !== null && replyTo !== "") {
            const parentId = String(replyTo);

            if (!isObjectId(parentId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid message being replied to"
                });
            }

            const parentMessage = await Message.findOne({
                _id: parentId,
                chat: chat._id,
                isDeleted: { $ne: true },
                deletedFor: { $ne: req.user._id },
            }).select("_id");

            if (!parentMessage) {
                return res.status(400).json({
                    success: false,
                    message: "The message being replied to is not available"
                });
            }

            replyToId = parentMessage._id;
        }

        // Blocking is one-sided and silent. The blocker can't send, but someone
        // they blocked can still "send" — the message is stored, never
        // delivered, never shown to the blocker, and never previewed to them.
        const {
            blockedByUserIds,
            blockedBySenderIds,
            senderBlockedThem
        } = await getBlockedByUserIds(chat, req.user);

        // In a one-to-one chat a blocker can't send at all. In a group only
        // the member they blocked is excluded — everyone else still receives.
        if (senderBlockedThem && !chat.isGroup) {
            return res.status(403).json({
                message: "You can't send messages in this conversation"
            });
        }

        if (
            chat.isGroup &&
            chat.groupPermissions?.sendMessages === "admins" &&
            !(chat.groupAdmins || []).some(
                (adminId) =>
                    adminId.toString() === req.user._id.toString()
            )
        ) {
            return res.status(403).json({
                message: "Only admins can send messages in this group"
            });
        }

        // Nobody in here may receive this message.
        const invisibleIds = [
            ...new Set([...blockedByUserIds, ...blockedBySenderIds])
        ];

        // FormData carries the peaks as a JSON string; anything malformed just
        // falls back to an empty waveform and the client draws its own shape.
        let audioWaveform = [];

        try {
            const parsedWaveform = JSON.parse(waveform || "[]");

            if (Array.isArray(parsedWaveform)) {
                audioWaveform = parsedWaveform
                    .slice(0, 64)
                    .map((value) =>
                        Math.min(1, Math.max(0, Number(value) || 0))
                    );
            }
        } catch {
            audioWaveform = [];
        }

        const files = [];

        for (const file of uploadedFiles) {
            const isImage = file.mimetype.startsWith("image/");
            const isVideo = file.mimetype.startsWith("video/");
            const isAudio = file.mimetype.startsWith("audio/");
            const isPdf = file.mimetype === "application/pdf";

            // Cloudinary serves audio files through its "video" resource type,
            // which also gives the browser the right Content-Type for playback.
            const resourceType = isImage || isPdf
                ? "image"
                : isVideo || isAudio
                    ? "video"
                    : "raw";

            const displayName =
                stripControlChars(file.originalname).slice(0, 255) || "file";
            const safeOriginalName = displayName.replace(/[^\w.-]/g, "_");
            const fileNameWithoutExtension = safeOriginalName.replace(/\.[^/.]+$/, "");

            const publicId = resourceType === "raw"
                ? `${Date.now()}-${safeOriginalName}`
                : `${Date.now()}-${fileNameWithoutExtension}`;
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        folder: "bubbles/messages",
                        resource_type: resourceType,
                        public_id: publicId
                    },
                    (error, result) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(result);
                        }
                    }
                );

                uploadStream.end(file.buffer);
            });

            files.push({
                url: uploadResult.secure_url,
                name: displayName,
                mimeType: file.mimetype,
                size: file.size,
                duration: isAudio
                    ? Math.min(86400, Math.max(0, Number(duration) || 0))
                    : 0,
                waveform: isAudio ? audioWaveform : []
            });
        }

        // The server, not the browser, decides the message kind. This stops a
        // client from injecting fake system/call bubbles into a chat.
        const finalMessageType = files.length > 0
            ? (files.every((file) => file.mimeType.startsWith("image/"))
                ? "image"
                : files.every((file) => file.mimeType.startsWith("audio/"))
                    ? "audio"
                    : "file")
            : "text";

        const message = new Message({
            chat: chatId,
            sender: req.user._id,
            text: messageText,
            messageType: finalMessageType,
            files,
            replyTo: replyToId,
            blockedFor: invisibleIds
        });

        await message.save();

        // A blocked message must not change the blocker's chat preview either.
        if (invisibleIds.length === 0) {
            chat.lastMessage = messageText || (
                finalMessageType === "image"
                    ? "Photo"
                    : finalMessageType === "audio"
                        ? "Voice message"
                        : "File"
            );
            chat.lastMessageAt = new Date();
            chat.lastMessageSender = req.user._id;

            // A new message brings a deleted chat back for everyone in it.
            chat.hiddenFor = (chat.hiddenFor || []).filter(
                (hiddenUserId) =>
                    !chat.participants.some(
                        (participantId) =>
                            participantId.toString() ===
                            hiddenUserId.toString()
                    )
            );

            await chat.save();
        }

        const io = req.app.get("io");

        const recipientIds = chat.participants
            .map((participant) => participant.toString())
            .filter(
                (participantId) =>
                    participantId !== req.user._id.toString() &&
                    !invisibleIds.includes(participantId)
            );

        let isDelivered = false;

        if (io) {
            for (const recipientId of recipientIds) {
                const recipientRoom = `user:${recipientId}`;
                const recipientSockets =
                    io.sockets.adapter.rooms.get(recipientRoom);

                if (recipientSockets && recipientSockets.size > 0) {
                    isDelivered = true;
                    break;
                }
            }
        }

        if (isDelivered) {
            message.isDelivered = true;
            message.deliveredAt = new Date();
            await message.save();
        }

        // Never expose the block bookkeeping to the client — the sender would
        // otherwise be able to see that they were blocked.
        message.blockedFor = undefined;

        await message.populate(
            "sender",
            "name username profilePicture"
        );

        const populatedChat = await Chat.findById(chatId)
            .populate(
                "participants",
                "name username profilePicture bio isOnline lastSeen onlineStatus profilePhotoVisibility lastSeenVisibility blockedUsers blockedSnapshots"
            );

        if (io && populatedChat) {
            // Applies any frozen profile for the sender's own view and always
            // strips the internal block bookkeeping from the payload.
            applyBlockSnapshots(
                populatedChat.participants,
                req.user._id
            );

            populatedChat.participants
                .filter(
                    (participant) =>
                        !invisibleIds.includes(
                            participant._id.toString()
                        )
                )
                .forEach((participant) => {
                    const participantRoom =
                        `user:${participant._id.toString()}`;

                    io.to(participantRoom).emit("newMessage", {
                        message,
                        chat: populatedChat
                    });
                });

            if (isDelivered) {
                io.to(`user:${req.user._id.toString()}`).emit(
                    "messageDelivered",
                    {
                        messageId: message._id.toString(),
                        chatId: chatId.toString(),
                        deliveredAt: message.deliveredAt
                    }
                );
            }
        }

        return res.status(201).json({
            message: "Message sent successfully",
            data: message
        });
    } catch (error) {
        next(error);
    }
};

// The caller's client reports how a call finished; the server turns it into a
// normal message so both sides get it live and it survives a refresh.
exports.logCall = async (req, res, next) => {
    try {
        const { chatId: rawChatId, callType, status, duration } = req.body;
        const chatId = String(rawChatId || "");

        if (!isObjectId(chatId)) {
            return res.status(400).json({
                success: false,
                message: "A valid chat is required"
            });
        }

        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        const {
            blockedByUserIds,
            blockedBySenderIds,
            senderBlockedThem
        } = await getBlockedByUserIds(chat, req.user);

        if (senderBlockedThem && !chat.isGroup) {
            return res.status(403).json({
                message: "You can't call this contact"
            });
        }

        const invisibleIds = [
            ...new Set([...blockedByUserIds, ...blockedBySenderIds])
        ];

        const safeCallType = callType === "video" ? "video" : "audio";

        const safeStatus = [
            "completed",
            "missed",
            "declined",
            "cancelled"
        ].includes(status)
            ? status
            : "missed";

        const safeDuration = Math.min(
            86400,
            Math.max(0, Math.round(Number(duration) || 0))
        );

        const message = new Message({
            chat: chatId,
            sender: req.user._id,
            text: "",
            messageType: "call",
            callInfo: {
                callType: safeCallType,
                status: safeStatus,
                duration: safeDuration
            },
            blockedFor: invisibleIds
        });

        await message.save();

        if (invisibleIds.length === 0) {
            chat.lastMessage = buildCallPreview(
                safeCallType,
                safeStatus
            );
            chat.lastMessageAt = new Date();
            chat.lastMessageSender = req.user._id;
            chat.hiddenFor = [];

            await chat.save();
        }

        message.blockedFor = undefined;

        await message.populate("sender", "name username profilePicture");

        const io = req.app.get("io");

        await broadcastMessage(
            io,
            chatId,
            message,
            req.user._id,
            invisibleIds
        );

        return res.status(201).json({
            message: "Call logged",
            data: message
        });

    } catch (error) {
        next(error);
    }
};

exports.getChatMessages = async (req, res, next) => {
    try {
        const { chatId } = req.params;

        if (!chatId) {
            return res.status(400).json({
                message: "Chat ID is required"
            });
        }

        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        const messages = await Message.find({
            chat: chatId,
            deletedFor: {
                $ne: req.user._id
            },
            // Messages written while this user had the sender blocked.
            blockedFor: {
                $ne: req.user._id
            }
        })
            .populate(
                "sender",
                "name username profilePicture blockedUsers blockedSnapshots"
            )
            .populate(
                "replyTo",
                "text sender messageType isDeleted isEdited"
            )
            .populate(
                "pinnedBy",
                "name username blockedUsers blockedSnapshots"
            )
            .populate(
                "reactions.user",
                "name username profilePicture blockedUsers blockedSnapshots"
            )
            .sort({
                createdAt: 1
            });

        // Anywhere a blocked contact's profile shows up in this payload, it
        // stays frozen at the moment they blocked us.
        applyBlockSnapshots(
            [
                ...messages.map((message) => message.sender),
                ...messages.map((message) => message.pinnedBy),
                ...messages.flatMap((message) =>
                    (message.reactions || []).map((reaction) => reaction.user)
                )
            ].filter(Boolean),
            req.user._id
        );

        return res.status(200).json({
            message: "Messages fetched successfully",
            messages: messages.map((message) => ({
                ...message.toObject(),
                reactions: serializeReactions(message.reactions)
            }))
        });

    } catch (error) {
        next(error);
    }
};

exports.markMessagesAsRead = async (req, res, next) => {
    try {
        const { chatId } = req.params;

        if (!chatId) {
            return res.status(400).json({
                message: "Chat ID is required"
            });
        }

        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        const unreadMessages = await Message.find({
            chat: chatId,
            sender: { $ne: req.user._id },
            blockedFor: { $ne: req.user._id },
            isRead: false
        });

        if (unreadMessages.length === 0) {
            return res.status(200).json({
                message: "No unread messages"
            });
        }

        const now = new Date();

        // Only touch the messages we actually just read — never the ones that
        // were written while this user had the sender blocked.
        const unreadMessageIds = unreadMessages.map(
            (message) => message._id
        );

        // Delivery and read are stamped separately so "Message info" can show
        // when each happened (deliveredAt keeps its original value).
        await Message.updateMany(
            {
                _id: { $in: unreadMessageIds },
                isDelivered: false
            },
            {
                $set: {
                    isDelivered: true,
                    deliveredAt: now
                }
            }
        );

        await Message.updateMany(
            {
                _id: { $in: unreadMessageIds },
                isRead: false
            },
            {
                $set: {
                    isRead: true,
                    readAt: now
                }
            }
        );

        const io = req.app.get("io");

        const messageIdsBySender = new Map();

        unreadMessages.forEach((message) => {
            const senderId = message.sender.toString();

            if (!messageIdsBySender.has(senderId)) {
                messageIdsBySender.set(senderId, []);
            }

            messageIdsBySender.get(senderId).push(
                message._id.toString()
            );
        });

        messageIdsBySender.forEach((messageIds, senderId) => {
            io.to(`user:${senderId}`).emit(
                "messagesRead",
                {
                    chatId,
                    messageIds,
                    readBy: req.user._id.toString(),
                    readAt: now
                }
            );
        });

        return res.status(200).json({
            message: "Messages marked as read"
        });

    } catch (error) {
        next(error);
    }
};

exports.togglePinMessage = async (req, res, next) => {
    try {
        const { messageId } = req.params;

        if (!messageId) {
            return res.status(400).json({
                message: "Message ID is required"
            });
        }

        const message = await Message.findOne({
            _id: messageId,
            // A message hidden by a block can't be pinned or unpinned either.
            blockedFor: { $ne: req.user._id }
        }).select("+blockedFor");

        if (!message) {
            return res.status(404).json({
                message: "Message not found"
            });
        }

        if (message.isDeleted) {
            return res.status(400).json({
                message: "Deleted messages cannot be pinned"
            });
        }

        const chat = await Chat.findById(message.chat);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        if (message.isPinned) {
            // Only whoever pinned it may take it down again.
            const pinnedById = message.pinnedBy
                ? message.pinnedBy.toString()
                : null;

            // Legacy pins recorded no pinner — let any participant clear those.
            if (pinnedById && pinnedById !== req.user._id.toString()) {
                return res.status(403).json({
                    message: "Only the person who pinned this message can unpin it"
                });
            }

            message.isPinned = false;
            message.pinnedAt = null;
            message.pinnedBy = null;
        } else {
            message.isPinned = true;
            message.pinnedAt = new Date();
            message.pinnedBy = req.user._id;
        }

        await message.save();

        await message.populate("pinnedBy", "name username");

        const io = req.app.get("io");

        // A pin on a message the other side was blocked from seeing must not
        // surface as a banner for them.
        const blockedForIds = (message.blockedFor || []).map(
            (blockedUserId) => blockedUserId.toString()
        );

        // Both participants see the pinned banner update live, including
        // who pinned it.
        if (io) {
            chat.participants
                .filter(
                    (participant) =>
                        !blockedForIds.includes(participant.toString())
                )
                .forEach((participant) => {
                    io.to(`user:${participant.toString()}`).emit(
                        "messagePinned",
                        {
                            chatId: message.chat.toString(),
                            messageId: message._id.toString(),
                            isPinned: message.isPinned,
                            pinnedAt: message.pinnedAt,
                            pinnedBy: message.pinnedBy
                                ? {
                                      _id: message.pinnedBy._id.toString(),
                                      name: message.pinnedBy.name,
                                      username: message.pinnedBy.username
                                  }
                                : null
                        }
                    );
                });
        }

        return res.status(200).json({
            message: message.isPinned
                ? "Message pinned"
                : "Message unpinned",
            data: {
                ...message.toObject(),
                blockedFor: undefined
            }
        });

    } catch (error) {
        next(error);
    }
};

exports.markMessagesAsDelivered = async (req, res, next) => {
    try {
        const { chatId } = req.params;

        if (!chatId) {
            return res.status(400).json({
                message: "Chat ID is required"
            });
        }

        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        const undeliveredMessages = await Message.find({
            chat: chatId,
            sender: { $ne: req.user._id },
            blockedFor: { $ne: req.user._id },
            isDelivered: false
        }).select("_id sender");

        if (undeliveredMessages.length === 0) {
            return res.status(200).json({
                message: "No undelivered messages"
            });
        }

        const now = new Date();

        await Message.updateMany(
            {
                _id: {
                    $in: undeliveredMessages.map(
                        (message) => message._id
                    )
                }
            },
            {
                $set: {
                    isDelivered: true,
                    deliveredAt: now
                }
            }
        );

        const io = req.app.get("io");

        // Only the "delivered" tick is reported here — isRead is untouched
        // so senders never see a read receipt from a user who hid them.
        if (io) {
            undeliveredMessages.forEach((message) => {
                io.to(`user:${message.sender.toString()}`).emit(
                    "messageDelivered",
                    {
                        messageId: message._id.toString(),
                        chatId: chatId.toString(),
                        deliveredAt: now
                    }
                );
            });
        }

        return res.status(200).json({
            message: "Messages marked as delivered"
        });

    } catch (error) {
        next(error);
    }
};

exports.deleteMessage = async (req, res, next) => {
    try {
        const { messageId } = req.params;

        if (!messageId) {
            return res.status(400).json({
                message: "Message ID is required"
            });
        }

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({
                message: "Message not found"
            });
        }

        const chat = await Chat.findById(message.chat);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        const isSender =
            message.sender.toString() === req.user._id.toString();

        const alreadyDeletedForUser = message.deletedFor?.some(
            (userId) =>
                userId.toString() === req.user._id.toString()
        );

        if (alreadyDeletedForUser) {
            return res.status(400).json({
                message: "Message is already deleted for you"
            });
        }

        if (message.isDeleted) {
            message.deletedFor.push(req.user._id);

            await message.save();

            const io = req.app.get("io");

            if (io) {
                io.to(`user:${req.user._id.toString()}`).emit(
                    "messageDeletedForUser",
                    {
                        messageId: message._id.toString(),
                        chatId: message.chat.toString()
                    }
                );
            }

            return res.status(200).json({
                message: "Deleted for you",
                deleteType: "forMe",
                data: message
            });
        }

        if (isSender) {
            const wasPinned = message.isPinned;

            message.isDeleted = true;
            message.deletedAt = new Date();
            message.text = "";

            // A deleted message can't stay pinned — otherwise nobody could
            // ever take it down from the banner.
            message.isPinned = false;
            message.pinnedAt = null;
            message.pinnedBy = null;

            await message.save();

            const io = req.app.get("io");

            if (io) {
                chat.participants.forEach((participant) => {
                    io.to(`user:${participant.toString()}`).emit(
                        "messageDeleted",
                        {
                            messageId: message._id.toString(),
                            chatId: message.chat.toString()
                        }
                    );
                });

                if (wasPinned) {
                    chat.participants.forEach((participant) => {
                        io.to(`user:${participant.toString()}`).emit(
                            "messagePinned",
                            {
                                chatId: message.chat.toString(),
                                messageId: message._id.toString(),
                                isPinned: false,
                                pinnedAt: null,
                                pinnedBy: null
                            }
                        );
                    });
                }
            }

            return res.status(200).json({
                message: "Message deleted for everyone",
                deleteType: "everyone",
                data: message
            });
        }

        message.deletedFor.push(req.user._id);

        await message.save();

        const io = req.app.get("io");

        if (io) {
            io.to(`user:${req.user._id.toString()}`).emit(
                "messageDeletedForUser",
                {
                    messageId: message._id.toString(),
                    chatId: message.chat.toString()
                }
            );
        }

        return res.status(200).json({
            message: "Message deleted for you",
            deleteType: "forMe",
            data: message
        });

    } catch (error) {
        next(error);
    }
};

exports.editMessage = async (req, res, next) => {
    try {
        const { messageId } = req.params;
        const text =
            typeof req.body?.text === "string"
                ? req.body.text.replace(/\u0000/g, "").trim()
                : "";

        if (!messageId) {
            return res.status(400).json({
                message: "Message ID is required"
            });
        }

        if (!text) {
            return res.status(400).json({
                message: "Message text is required"
            });
        }

        if (text.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer`
            });
        }

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({
                message: "Message not found"
            });
        }

        const chat = await Chat.findById(message.chat);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        const isSender =
            message.sender.toString() === req.user._id.toString();

        if (!isSender) {
            return res.status(403).json({
                message: "You can only edit your own messages"
            });
        }

        if (message.isDeleted) {
            return res.status(400).json({
                message: "Deleted messages cannot be edited"
            });
        }

        message.text = text;
        message.isEdited = true;

        await message.save();

        await message.populate(
            "sender",
            "name username profilePicture"
        );

        const io = req.app.get("io");

        if (io) {
            chat.participants.forEach((participant) => {
                io.to(`user:${participant.toString()}`).emit(
                    "messageEdited",
                    {
                        message
                    }
                );
            });
        }

        return res.status(200).json({
            message: "Message edited successfully",
            data: message
        });
    } catch (error) {
        next(error);
    }
};

exports.forwardMessage = async (req, res) => {
    try {
        const { messageId: rawMessageId, chatIds } = req.body;
        const messageId = String(rawMessageId || "");
        const userId = req.user._id;

        if (
            !isObjectId(messageId) ||
            !Array.isArray(chatIds) ||
            chatIds.length === 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Message ID and destination chats are required"
            });
        }

        if (chatIds.length > MAX_FORWARD_TARGETS) {
            return res.status(400).json({
                success: false,
                message: `You can forward to at most ${MAX_FORWARD_TARGETS} chats at once`
            });
        }

        const uniqueChatIds = [
            ...new Set(chatIds.map(String)),
        ].filter((chatId) => isObjectId(chatId));

        if (uniqueChatIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Choose at least one valid destination chat"
            });
        }

        const originalMessage = await Message.findOne({
            _id: messageId,
            isDeleted: { $ne: true },
            deletedFor: { $ne: userId }
        });

        if (!originalMessage) {
            return res.status(404).json({
                message: "Message not found or unavailable"
            });
        }

        const sourceChat = await Chat.findById(originalMessage.chat);

        if (!sourceChat || !sourceChat.participants.some(
            participant => participant.toString() === userId.toString()
        )) {
            return res.status(403).json({
                message: "You are not allowed to forward this message"
            });
        }

        const io = req.app.get("io");
        const forwardedMessages = [];

        for (const chatId of uniqueChatIds) {
            const destinationChat = await Chat.findById(chatId);

            if (!destinationChat) {
                return res.status(404).json({
                    message: "One of the destination chats was not found"
                });
            }

            const isParticipant = destinationChat.participants.some(
                participant => participant.toString() === userId.toString()
            );

            if (!isParticipant) {
                return res.status(403).json({
                    message: "You are not a participant in a destination chat"
                });
            }

            if (
                destinationChat.isGroup &&
                destinationChat.groupPermissions?.sendMessages === "admins" &&
                !(destinationChat.groupAdmins || []).some(
                    (adminId) =>
                        adminId.toString() === userId.toString()
                )
            ) {
                return res.status(403).json({
                    message:
                        "Only admins can send messages in that group"
                });
            }

            // Forwarding is a send: a block in either direction applies.
            const { blockedByUserIds, senderBlockedThem } =
                await getBlockedByUserIds(destinationChat, req.user);

            if (senderBlockedThem) {
                return res.status(403).json({
                    message: "You can't send messages in this conversation"
                });
            }

            const forwardedMessage = await Message.create({
                chat: destinationChat._id,
                sender: userId,
                text: originalMessage.text,
                messageType: originalMessage.messageType,
                files: (originalMessage.files || []).map(file => ({
                    url: file.url,
                    name: file.name,
                    mimeType: file.mimeType,
                    size: file.size,
                    duration: file.duration || 0,
                    waveform: file.waveform || []
                })),
                replyTo: null,
                isForwarded: true,
                blockedFor: blockedByUserIds
            });

            if (blockedByUserIds.length === 0) {
                destinationChat.lastMessage = forwardedMessage.text || (
                    forwardedMessage.messageType === "image"
                        ? "Photo"
                        : forwardedMessage.messageType === "file"
                            ? "File"
                            : forwardedMessage.messageType === "audio"
                                ? "Voice message"
                                : ""
                );
                destinationChat.lastMessageAt = forwardedMessage.createdAt;
                await destinationChat.save();
            }

            const populatedMessage = await Message.findById(forwardedMessage._id)
                .populate("sender", "username name profilePicture")
                .populate({
                    path: "replyTo",
                    populate: {
                        path: "sender",
                        select: "username name profilePicture"
                    }
                });

            populatedMessage.blockedFor = undefined;

            const populatedChat = await Chat.findById(destinationChat._id)
                .populate(
                    "participants",
                    "username name profilePicture blockedUsers blockedSnapshots"
                );

            if (io) {
                applyBlockSnapshots(
                    populatedChat?.participants,
                    req.user._id
                );

                destinationChat.participants
                    .filter(
                        (participantId) =>
                            !blockedByUserIds.includes(
                                participantId.toString()
                            )
                    )
                    .forEach(participantId => {
                        io.to(`user:${participantId.toString()}`).emit("newMessage", {
                            message: populatedMessage,
                            chat: populatedChat
                        });
                    });
            }

            forwardedMessages.push(populatedMessage);
        }

        return res.status(201).json({
            message: "Message forwarded successfully",
            forwardedMessages
        });
    } catch (error) {
        console.error("Forward message error:", error);

        return res.status(500).json({
            message: "Failed to forward message",
            error: error.message
        });
    }
};

exports.clearChat = async (req, res, next) => {
    try {
        const { chatId } = req.params;

        if (!chatId) {
            return res.status(400).json({
                message: "Chat ID is required"
            });
        }

        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        // Cleared only for the requesting user — the other participant keeps
        // their copy of the conversation.
        await Message.updateMany(
            { chat: chatId },
            { $addToSet: { deletedFor: req.user._id } }
        );

        return res.status(200).json({
            message: "Chat cleared successfully"
        });

    } catch (error) {
        next(error);
    }
};

// A small, fixed set keeps reactions consistent between clients and stops a
// message from being turned into an arbitrary block of text.
const REACTION_EMOJIS = new Set([
    "👍",
    "❤️",
    "😂",
    "😮",
    "😢",
    "🙏",
    "🔥",
    "👏"
]);

const REACTION_USER_FIELDS = "name username profilePicture";

exports.toggleMessageReaction = async (req, res, next) => {
    try {
        const { messageId } = req.params;
        const emoji =
            typeof req.body?.emoji === "string"
                ? req.body.emoji.trim()
                : "";

        if (!messageId) {
            return res.status(400).json({
                message: "Message ID is required"
            });
        }

        if (!REACTION_EMOJIS.has(emoji)) {
            return res.status(400).json({
                message: "That reaction is not available"
            });
        }

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({
                message: "Message not found"
            });
        }

        if (message.isDeleted) {
            return res.status(400).json({
                message: "You cannot react to a deleted message"
            });
        }

        const chat = await Chat.findById(message.chat);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        const userId = req.user._id.toString();
        const existing = (message.reactions || []).find(
            (reaction) => reaction.user.toString() === userId
        );

        // Tapping the same emoji again removes the reaction; tapping a
        // different one replaces it.
        message.reactions = (message.reactions || []).filter(
            (reaction) => reaction.user.toString() !== userId
        );

        if (!existing || existing.emoji !== emoji) {
            message.reactions.push({
                user: req.user._id,
                emoji,
                createdAt: new Date()
            });
        }

        await message.save();
        await message.populate("reactions.user", REACTION_USER_FIELDS);

        const payload = {
            messageId: message._id.toString(),
            chatId: message.chat.toString(),
            reactions: serializeReactions(message.reactions)
        };

        const io = req.app.get("io");

        if (io) {
            chat.participants.forEach((participant) => {
                io.to(`user:${participant.toString()}`).emit(
                    "messageReaction",
                    payload
                );
            });
        }

        return res.status(200).json({
            success: true,
            message: "Reaction updated",
            reactions: serializeReactions(message.reactions)
        });

    } catch (error) {
        next(error);
    }
};