const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const Message = require("../models/messageModel");
const Report = require("../models/reportModel");
const cloudinary = require("../config/cloudinary");
const { applyBlockSnapshots } = require("../utils/blockHelpers");
const {
    PARTICIPANT_FIELDS,
    createSystemMessage
} = require("../utils/messageHelpers");

const isAdmin = (chat, userId) =>
    (chat.groupAdmins || []).some(
        (adminId) => adminId.toString() === userId.toString()
    );

const getIo = (req) => req.app.get("io");

// Every group mutation ends the same way: tell each member to refresh their
// chat list, so names, avatars, previews and membership stay in sync.
const notifyChatsChanged = (io, participantIds) => {
    if (!io) {
        return;
    }

    participantIds.forEach((participantId) => {
        io.to(`user:${participantId.toString()}`).emit("chatsChanged");
    });
};

const uploadGroupAvatar = (file) =>
    new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: "bubbles/groups",
                resource_type: "image"
            },
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result.secure_url);
                }
            }
        );

        uploadStream.end(file.buffer);
    });

const parseParticipantIds = (value) => {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.map(String);
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);

            if (Array.isArray(parsed)) {
                return parsed.map(String);
            }
        } catch {
            return value.split(",").map((entry) => entry.trim());
        }
    }

    return [];
};

const populateChat = (chatId) =>
    Chat.findById(chatId).populate("participants", PARTICIPANT_FIELDS);


exports.createOrGetChat = async (req, res, next) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                message: "User ID is required"
            });
        }

        if (req.user._id.toString() === userId.toString()) {
            return res.status(400).json({
                message: "You cannot create a chat with yourself"
            });
        }

        const selectedUser = await User.findById(userId);

        if (!selectedUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const existingChat = await Chat.findOne({
            isGroup: { $ne: true },
            participants: {
                $all: [req.user._id, userId],
                $size: 2
            }
        });

        if (existingChat) {
            // Re-opening a chat the user had deleted puts it back in their list.
            const wasHidden = existingChat.hiddenFor?.some(
                (hiddenUserId) =>
                    hiddenUserId.toString() === req.user._id.toString()
            );

            if (wasHidden) {
                existingChat.hiddenFor = existingChat.hiddenFor.filter(
                    (hiddenUserId) =>
                        hiddenUserId.toString() !== req.user._id.toString()
                );

                await existingChat.save();
            }

            return res.status(200).json({
                message: "Chat found",
                chat: existingChat
            });
        }

        const newChat = new Chat({
            participants: [
                req.user._id,
                userId
            ]
        });

        await newChat.save();

        return res.status(201).json({
            message: "Chat created successfully",
            chat: newChat
        });

    } catch (error) {
        next(error);
    }
};

exports.getMyChats = async (req, res, next) => {
    try {
        const chats = await Chat.find({
            participants: req.user._id,
            hiddenFor: { $ne: req.user._id }
        }).populate("participants", "name username profilePicture bio isOnline lastSeen onlineStatus profilePhotoVisibility lastSeenVisibility blockedUsers blockedSnapshots").sort({ lastMessageAt: -1, updatedAt: -1 });

        // Blocked contacts keep showing the profile they had at block time.
        chats.forEach((chat) =>
            applyBlockSnapshots(chat.participants, req.user._id)
        );

        if (chats.length > 0) {
            // The chat document holds one shared preview. Once a blocked person
            // keeps writing, that preview is stale for *them* (their own
            // messages never update it), so patch just those chats.
            const blockedOwnMessages = await Message.aggregate([
                {
                    $match: {
                        chat: { $in: chats.map((chat) => chat._id) },
                        sender: req.user._id,
                        "blockedFor.0": { $exists: true },
                        deletedFor: { $ne: req.user._id }
                    }
                },
                { $sort: { createdAt: -1 } },
                {
                    $group: {
                        _id: "$chat",
                        text: { $first: "$text" },
                        messageType: { $first: "$messageType" },
                        sender: { $first: "$sender" },
                        createdAt: { $first: "$createdAt" }
                    }
                }
            ]);

            const previewsByChat = new Map(
                blockedOwnMessages.map((entry) => [
                    entry._id.toString(),
                    entry
                ])
            );

            chats.forEach((chat) => {
                const preview = previewsByChat.get(chat._id.toString());

                if (!preview) {
                    return;
                }

                const chatLastMessageAt = chat.lastMessageAt
                    ? new Date(chat.lastMessageAt).getTime()
                    : 0;

                if (new Date(preview.createdAt).getTime() <= chatLastMessageAt) {
                    return;
                }

                chat.lastMessage =
                    preview.text ||
                    (preview.messageType === "image"
                        ? "Photo"
                        : preview.messageType === "audio"
                            ? "Voice message"
                            : preview.messageType === "call"
                                ? "Call"
                                : preview.messageType === "system"
                                    ? ""
                                    : "File");
                chat.lastMessageAt = preview.createdAt;
                chat.lastMessageSender = preview.sender;
            });

            chats.sort(
                (firstChat, secondChat) =>
                    new Date(secondChat.lastMessageAt || 0) -
                    new Date(firstChat.lastMessageAt || 0)
            );
        }

        return res.status(200).json({
            message: "Chats fetched successfully",
            chats
        });

    } catch (error) {
        next(error);
    }
};

exports.deleteChat = async (req, res, next) => {
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

        // Deleted only for the requesting user — the other participant keeps
        // their copy, and a future message brings it back.
        await Chat.findByIdAndUpdate(chatId, {
            $addToSet: {
                hiddenFor: req.user._id
            }
        });

        return res.status(200).json({
            message: "Chat deleted successfully"
        });

    } catch (error) {
        next(error);
    }
};

exports.createGroup = async (req, res, next) => {
    try {
        const name = (req.body.name || "").trim();

        if (!name) {
            return res.status(400).json({
                message: "Group name is required"
            });
        }

        if (name.length > 60) {
            return res.status(400).json({
                message: "Group name is too long"
            });
        }

        const requestedIds = [
            ...new Set(
                parseParticipantIds(
                    req.body.participantIds || req.body.members
                ).filter(
                    (participantId) =>
                        participantId &&
                        participantId !== req.user._id.toString()
                )
            )
        ];

        const users = requestedIds.length
            ? await User.find({ _id: { $in: requestedIds } }).select("_id")
            : [];

        const memberIds = users.map((user) => user._id.toString());

        const avatar = req.file
            ? await uploadGroupAvatar(req.file)
            : (req.body.avatar || "").trim();

        const chat = await Chat.create({
            participants: [req.user._id, ...memberIds],
            isGroup: true,
            groupName: name,
            groupDescription: (req.body.description || "").trim(),
            groupAvatar: avatar,
            groupAdmins: [req.user._id],
            groupCreatedBy: req.user._id
        });

        const io = getIo(req);

        await createSystemMessage(
            io,
            chat._id,
            req.user._id,
            `${req.user.name} created the group "${name}"`
        );

        const populatedChat = await populateChat(chat._id);

        notifyChatsChanged(io, chat.participants);

        return res.status(201).json({
            message: "Group created successfully",
            chat: populatedChat
        });

    } catch (error) {
        next(error);
    }
};

exports.getChatById = async (req, res, next) => {
    try {
        const chat = await populateChat(req.params.chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participant) =>
                participant._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        applyBlockSnapshots(chat.participants, req.user._id);

        return res.status(200).json({
            message: "Chat fetched successfully",
            chat
        });

    } catch (error) {
        next(error);
    }
};

exports.updateGroup = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);

        if (!chat || !chat.isGroup) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        if (!isAdmin(chat, req.user._id)) {
            const canEdit =
                chat.groupPermissions?.editInfo === "all" &&
                chat.participants.some(
                    (participantId) =>
                        participantId.toString() === req.user._id.toString()
                );

            if (!canEdit) {
                return res.status(403).json({
                    message: "Only admins can edit this group"
                });
            }
        }

        const changes = [];

        if (typeof req.body.name === "string") {
            const nextName = req.body.name.trim();

            if (!nextName) {
                return res.status(400).json({
                    message: "Group name is required"
                });
            }

            if (nextName !== chat.groupName) {
                chat.groupName = nextName;
                changes.push(`changed the group name to "${nextName}"`);
            }
        }

        if (typeof req.body.description === "string") {
            chat.groupDescription = req.body.description.trim();
        }

        if (req.file) {
            chat.groupAvatar = await uploadGroupAvatar(req.file);
            changes.push("changed the group photo");
        } else if (typeof req.body.avatar === "string" && req.body.avatar) {
            chat.groupAvatar = req.body.avatar.trim();
        }

        await chat.save();

        const io = getIo(req);

        for (const change of changes) {
            await createSystemMessage(
                io,
                chat._id,
                req.user._id,
                `${req.user.name} ${change}`
            );
        }

        const populatedChat = await populateChat(chat._id);

        notifyChatsChanged(io, chat.participants);

        return res.status(200).json({
            message: "Group updated successfully",
            chat: populatedChat
        });

    } catch (error) {
        next(error);
    }
};

exports.addGroupMembers = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);

        if (!chat || !chat.isGroup) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        const isMember = chat.participants.some(
            (participantId) =>
                participantId.toString() === req.user._id.toString()
        );

        if (!isMember) {
            return res.status(403).json({
                message: "You are not a member of this group"
            });
        }

        if (
            chat.groupPermissions?.addMembers === "admins" &&
            !isAdmin(chat, req.user._id)
        ) {
            return res.status(403).json({
                message: "Only admins can add members"
            });
        }

        const requestedIds = parseParticipantIds(
            req.body.participantIds || req.body.members
        ).filter(Boolean);

        const existingIds = chat.participants.map((participantId) =>
            participantId.toString()
        );

        const newIds = [
            ...new Set(
                requestedIds.filter(
                    (participantId) =>
                        !existingIds.includes(participantId)
                )
            )
        ];

        if (newIds.length === 0) {
            return res.status(400).json({
                message: "No new members to add"
            });
        }

        const users = await User.find({ _id: { $in: newIds } }).select(
            "name"
        );

        if (users.length === 0) {
            return res.status(400).json({
                message: "No valid members to add"
            });
        }

        const addedIds = users.map((user) => user._id.toString());

        chat.participants = [...chat.participants, ...addedIds];

        // Someone who was removed before could still be in hiddenFor.
        chat.hiddenFor = (chat.hiddenFor || []).filter(
            (hiddenUserId) =>
                !addedIds.includes(hiddenUserId.toString())
        );

        await chat.save();

        const io = getIo(req);

        await createSystemMessage(
            io,
            chat._id,
            req.user._id,
            `${req.user.name} added ${users
                .map((user) => user.name)
                .join(", ")}`
        );

        const populatedChat = await populateChat(chat._id);

        notifyChatsChanged(io, chat.participants);

        return res.status(200).json({
            message: "Members added successfully",
            chat: populatedChat
        });

    } catch (error) {
        next(error);
    }
};

exports.removeGroupMember = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);
        const { userId } = req.params;

        if (!chat || !chat.isGroup) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        if (!isAdmin(chat, req.user._id)) {
            return res.status(403).json({
                message: "Only admins can remove members"
            });
        }

        if (userId.toString() === req.user._id.toString()) {
            return res.status(400).json({
                message: "Use leave group to remove yourself"
            });
        }

        // The creator is the group's super admin: nobody can remove them,
        // no matter how many admin privileges they hold.
        if (
            chat.groupCreatedBy &&
            userId.toString() === chat.groupCreatedBy.toString()
        ) {
            return res.status(403).json({
                message: "The group creator can't be removed"
            });
        }

        const target = chat.participants.find(
            (participantId) => participantId.toString() === userId
        );

        if (!target) {
            return res.status(404).json({
                message: "That user is not in this group"
            });
        }

        const removedUser = await User.findById(userId).select("name");

        chat.participants = chat.participants.filter(
            (participantId) => participantId.toString() !== userId
        );

        chat.groupAdmins = (chat.groupAdmins || []).filter(
            (adminId) => adminId.toString() !== userId
        );

        await chat.save();

        const io = getIo(req);

        await createSystemMessage(
            io,
            chat._id,
            req.user._id,
            `${req.user.name} removed ${removedUser?.name || "a member"}`
        );

        if (io) {
            io.to(`user:${userId}`).emit("chatRemoved", {
                chatId: chat._id.toString()
            });
        }

        const populatedChat = await populateChat(chat._id);

        notifyChatsChanged(io, [
            ...chat.participants,
            userId
        ]);

        return res.status(200).json({
            message: "Member removed successfully",
            chat: populatedChat
        });

    } catch (error) {
        next(error);
    }
};

exports.setGroupAdmin = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);
        const { userId } = req.params;

        if (!chat || !chat.isGroup) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        if (!isAdmin(chat, req.user._id)) {
            return res.status(403).json({
                message: "Only admins can change admin roles"
            });
        }

        const target = chat.participants.find(
            (participantId) => participantId.toString() === userId
        );

        if (!target) {
            return res.status(404).json({
                message: "That user is not in this group"
            });
        }

        const makeAdmin =
            typeof req.body.isAdmin === "boolean"
                ? req.body.isAdmin
                : !isAdmin(chat, userId);

        // The creator keeps the super-admin role permanently.
        if (
            !makeAdmin &&
            chat.groupCreatedBy &&
            userId.toString() === chat.groupCreatedBy.toString()
        ) {
            return res.status(403).json({
                message: "The group creator can't be dismissed as admin"
            });
        }

        if (!makeAdmin && (chat.groupAdmins || []).length === 1) {
            return res.status(400).json({
                message: "A group needs at least one admin"
            });
        }

        const targetUser = await User.findById(userId).select("name");

        if (makeAdmin) {
            chat.groupAdmins = [
                ...(chat.groupAdmins || []).map((adminId) =>
                    adminId.toString()
                ),
                userId
            ];
        } else {
            chat.groupAdmins = (chat.groupAdmins || []).filter(
                (adminId) => adminId.toString() !== userId
            );
        }

        await chat.save();

        const io = getIo(req);

        await createSystemMessage(
            io,
            chat._id,
            req.user._id,
            `${req.user.name} ${makeAdmin ? "made" : "removed"} ${
                targetUser?.name || "a member"
            } ${makeAdmin ? "an admin" : "as admin"}`
        );

        const populatedChat = await populateChat(chat._id);

        notifyChatsChanged(io, chat.participants);

        return res.status(200).json({
            message: "Admin role updated",
            chat: populatedChat
        });

    } catch (error) {
        next(error);
    }
};

exports.updateGroupPermissions = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);

        if (!chat || !chat.isGroup) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        if (!isAdmin(chat, req.user._id)) {
            return res.status(403).json({
                message: "Only admins can change group permissions"
            });
        }

        const { sendMessages, addMembers, editInfo } = req.body;
        const allowed = ["all", "admins"];

        chat.groupPermissions = {
            sendMessages: allowed.includes(sendMessages)
                ? sendMessages
                : chat.groupPermissions?.sendMessages || "all",
            addMembers: allowed.includes(addMembers)
                ? addMembers
                : chat.groupPermissions?.addMembers || "all",
            editInfo: allowed.includes(editInfo)
                ? editInfo
                : chat.groupPermissions?.editInfo || "admins"
        };

        await chat.save();

        const populatedChat = await populateChat(chat._id);

        notifyChatsChanged(getIo(req), chat.participants);

        return res.status(200).json({
            message: "Permissions updated",
            chat: populatedChat
        });

    } catch (error) {
        next(error);
    }
};

exports.leaveGroup = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);

        if (!chat || !chat.isGroup) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        const isMember = chat.participants.some(
            (participantId) =>
                participantId.toString() === req.user._id.toString()
        );

        if (!isMember) {
            return res.status(400).json({
                message: "You are not a member of this group"
            });
        }

        const leavingName = req.user.name;

        // The creator is the super admin: their exit ends the group for
        // everyone instead of leaving the rest of the members behind.
        if (
            chat.groupCreatedBy &&
            chat.groupCreatedBy.toString() === req.user._id.toString()
        ) {
            const participantIds = chat.participants.map((participantId) =>
                participantId.toString()
            );

            await Message.deleteMany({ chat: chat._id });
            await Chat.findByIdAndDelete(chat._id);

            const io = getIo(req);

            if (io) {
                participantIds.forEach((participantId) => {
                    io.to(`user:${participantId}`).emit("chatRemoved", {
                        chatId: chat._id.toString()
                    });
                });
            }

            return res.status(200).json({
                message: "Group deleted",
                deleted: true
            });
        }

        chat.participants = chat.participants.filter(
            (participantId) =>
                participantId.toString() !== req.user._id.toString()
        );

        chat.groupAdmins = (chat.groupAdmins || []).filter(
            (adminId) => adminId.toString() !== req.user._id.toString()
        );

        // Don't strand a group without an admin.
        if (
            chat.participants.length > 0 &&
            (chat.groupAdmins || []).length === 0
        ) {
            chat.groupAdmins = [chat.participants[0]];
        }

        const io = getIo(req);

        if (chat.participants.length === 0) {
            await Message.deleteMany({ chat: chat._id });
            await Chat.findByIdAndDelete(chat._id);

            return res.status(200).json({
                message: "Group deleted"
            });
        }

        await chat.save();

        await createSystemMessage(
            io,
            chat._id,
            req.user._id,
            `${leavingName} left the group`
        );

        if (io) {
            io.to(`user:${req.user._id}`).emit("chatRemoved", {
                chatId: chat._id.toString()
            });
        }

        notifyChatsChanged(io, chat.participants);

        return res.status(200).json({
            message: "You left the group"
        });

    } catch (error) {
        next(error);
    }
};

exports.deleteGroup = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);

        if (!chat || !chat.isGroup) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        // Only the creator can delete the group for everyone. Other members
        // (even admins) can only leave it from their side.
        if (
            !chat.groupCreatedBy ||
            chat.groupCreatedBy.toString() !== req.user._id.toString()
        ) {
            return res.status(403).json({
                message: "Only the group creator can delete this group"
            });
        }

        const participantIds = chat.participants.map((participantId) =>
            participantId.toString()
        );

        await Message.deleteMany({ chat: chat._id });
        await Chat.findByIdAndDelete(chat._id);

        const io = getIo(req);

        if (io) {
            participantIds.forEach((participantId) => {
                io.to(`user:${participantId}`).emit("chatRemoved", {
                    chatId: chat._id.toString()
                });
            });
        }

        return res.status(200).json({
            message: "Group deleted successfully"
        });

    } catch (error) {
        next(error);
    }
};

exports.reportChat = async (req, res, next) => {
    try {
        const chat = await Chat.findById(req.params.chatId);

        if (!chat) {
            return res.status(404).json({
                message: "Chat not found"
            });
        }

        const isParticipant = chat.participants.some(
            (participantId) =>
                participantId.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not a participant in this chat"
            });
        }

        // The creator has nothing to report about their own group.
        if (
            chat.isGroup &&
            chat.groupCreatedBy &&
            chat.groupCreatedBy.toString() === req.user._id.toString()
        ) {
            return res.status(400).json({
                message: "You can't report a group you created"
            });
        }

        const { reason, details } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                message: "A reason is required"
            });
        }

        const report = await Report.create({
            reporter: req.user._id,
            reportedUser: chat.groupCreatedBy || null,
            chat: chat._id,
            reason: reason.trim(),
            details: (details || "").trim()
        });

        return res.status(201).json({
            message: "Report submitted",
            report
        });

    } catch (error) {
        next(error);
    }
};