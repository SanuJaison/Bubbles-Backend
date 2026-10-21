const User = require("../models/userModel");
const Chat = require("../models/chatModel");
const Message = require("../models/messageModel");

const onlineUsers = new Map();
const typingUsers = new Map();

// Who is currently recording a voice note, per chat. Rendered like the
// typing indicator ("Alice is recording a voice message...").
const recordingUsers = new Map();

// Live calls keyed by callId, plus a userId -> callId index so a second
// incoming call can be declined and a dropped socket can hang up a call.
const activeCalls = new Map();
const busyUsers = new Map();

// Multi-party calls. Each participant connects directly to every other one
// (a mesh), so the server only keeps the roster and relays signalling.
const groupCalls = new Map();

const getUserRoom = (userId) => {
    return `user:${userId.toString()}`;
};

const getGroupCallForChat = (chatId) => {
    const roomId = chatId.toString();

    for (const session of groupCalls.values()) {
        if (session.chatId === roomId) {
            return session;
        }
    }

    return null;
};

const groupCallStatePayload = (session) => ({
    chatId: session.chatId,
    callId: session.id,
    callType: session.callType,
    active: session.joined.size > 0,
    participantCount: session.joined.size,
});

// Tells every member of the group whether a call is running, so anyone who
// missed the ring can still tap "Join".
const emitGroupCallState = (io, session) => {
    const payload = groupCallStatePayload(session);

    for (const participantId of session.participants) {
        io.to(getUserRoom(participantId)).emit("groupCall:state", payload);
    }
};

const endGroupCall = (io, session, reason = "ended") => {
    if (!session) {
        return;
    }

    for (const participantId of session.participants) {
        io.to(getUserRoom(participantId)).emit("groupCall:ended", {
            callId: session.id,
            reason,
        });

        io.to(getUserRoom(participantId)).emit("groupCall:state", {
            chatId: session.chatId,
            callId: session.id,
            callType: session.callType,
            active: false,
            participantCount: 0,
        });
    }

    for (const joinedId of session.joined.keys()) {
        if (busyUsers.get(joinedId) === session.id) {
            busyUsers.delete(joinedId);
        }
    }

    groupCalls.delete(session.id);
};

const leaveGroupCall = (io, session, userId) => {
    if (!session || !session.joined.has(userId)) {
        return;
    }

    session.joined.delete(userId);

    if (session.muted) {
        session.muted.delete(userId);
    }

    if (busyUsers.get(userId) === session.id) {
        busyUsers.delete(userId);
    }

    for (const otherId of session.joined.keys()) {
        io.to(getUserRoom(otherId)).emit("groupCall:participantLeft", {
            callId: session.id,
            userId,
        });
    }

    if (session.joined.size === 0) {
        endGroupCall(io, session, "ended");
    } else {
        emitGroupCallState(io, session);
    }
};

const clearCall = (callId) => {
    const call = activeCalls.get(callId);

    if (!call) {
        return null;
    }

    busyUsers.delete(call.callerId);
    busyUsers.delete(call.calleeId);
    activeCalls.delete(callId);

    return call;
};

// Used when a user disconnects or signs out mid-call: the other side is told
// the call ended so their UI never hangs on a dead connection.
const endCallForUser = (io, userId) => {
    const callId = busyUsers.get(userId.toString());

    if (!callId) {
        return;
    }

    // Group calls keep going for everyone else.
    const groupSession = groupCalls.get(callId);

    if (groupSession) {
        leaveGroupCall(io, groupSession, userId.toString());
        return;
    }

    const call = clearCall(callId);

    if (!call) {
        return;
    }

    const otherId =
        call.callerId === userId.toString()
            ? call.calleeId
            : call.callerId;

    io.to(getUserRoom(otherId)).emit("call:ended", {
        callId,
        reason: "disconnected",
    });
};

const getOnlineUserIds = async () => {
    const connectedIds = Array.from(onlineUsers.keys());

    if (connectedIds.length === 0) {
        return [];
    }

    const visibleUsers = await User.find({
        _id: { $in: connectedIds },
        onlineStatus: { $ne: false },
    }).select("_id");

    return visibleUsers.map((user) => user._id.toString());
};

const sendUserStatus = (io, userId, isOnline, lastSeen = null) => {
    io.emit("userStatus", {
        userId: userId.toString(),
        isOnline,
        lastSeen,
    });
};

const getChatParticipants = async (chatId) => {
    try {
        const chat = await Chat.findById(chatId)
            .select("participants");

        if (!chat) {
            return [];
        }

        return chat.participants.map((participant) =>
            participant.toString()
        );

    } catch (error) {
        console.error(
            "Error getting chat participants:",
            error
        );

        return [];
    }
};

// Typing events fire often, so resolve each name once per session.
const typingUserNameCache = new Map();

const getTypingUserName = async (userId) => {
    if (typingUserNameCache.has(userId)) {
        return typingUserNameCache.get(userId);
    }

    try {
        const user = await User.findById(userId).select("name");
        const name = user?.name || "Someone";

        typingUserNameCache.set(userId, name);

        return name;

    } catch {
        return "Someone";
    }
};

// Small public profile attached to group-call roster entries.
const getCallParticipantInfo = async (participantId) => {
    try {
        const user = await User.findById(participantId).select(
            "name username profilePicture"
        );

        if (!user) {
            return null;
        }

        return {
            id: user._id.toString(),
            name: user.name || user.username || "Someone",
            username: user.username || "",
            profilePicture: user.profilePicture || "",
        };

    } catch {
        return null;
    }
};

// Participants who blocked this user shouldn't see them typing either — a
// typing indicator would give the block away.
const getBlockedParticipantIds = async (participantIds, userId) => {
    if (!participantIds || participantIds.length === 0) {
        return [];
    }

    const users = await User.find({
        _id: { $in: participantIds }
    }).select("blockedUsers");

    return users
        .filter((user) =>
            (user.blockedUsers || []).some(
                (blockedUserId) =>
                    blockedUserId.toString() === userId.toString()
            )
        )
        .map((user) => user._id.toString());
};

const emitTypingToParticipants = async (
    io,
    chatId,
    userId,
    event
) => {

    const participants =
        await getChatParticipants(chatId);

    const blockedParticipantIds =
        await getBlockedParticipantIds(
            participants,
            userId
        );

    const userName = await getTypingUserName(userId);

    for (const participantId of participants) {

        if (participantId === userId) {
            continue;
        }

        if (blockedParticipantIds.includes(participantId)) {
            continue;
        }

        io.to(
            getUserRoom(participantId)
        ).emit(
            event,
            {
                chatId: chatId.toString(),
                userId,
                userName
            }
        );
    }
};

const addTypingUser = async (
    io,
    socket,
    chatId,
    userId
) => {

    const roomId = chatId.toString();

    if (!typingUsers.has(roomId)) {
        typingUsers.set(
            roomId,
            new Set()
        );
    }

    const chatTypingUsers =
        typingUsers.get(roomId);

    if (chatTypingUsers.has(userId)) {
        return;
    }

    chatTypingUsers.add(userId);

    await emitTypingToParticipants(
        io,
        roomId,
        userId,
        "userTyping"
    );
};

const removeTypingUser = async (
    io,
    socket,
    chatId,
    userId
) => {

    const roomId = chatId.toString();

    const chatTypingUsers =
        typingUsers.get(roomId);

    if (
        !chatTypingUsers ||
        !chatTypingUsers.has(userId)
    ) {
        return;
    }

    chatTypingUsers.delete(userId);

    await emitTypingToParticipants(
        io,
        roomId,
        userId,
        "userStoppedTyping"
    );

    if (chatTypingUsers.size === 0) {
        typingUsers.delete(roomId);
    }
};

const addRecordingUser = async (
    io,
    chatId,
    userId
) => {

    const roomId = chatId.toString();

    if (!recordingUsers.has(roomId)) {
        recordingUsers.set(
            roomId,
            new Set()
        );
    }

    const chatRecordingUsers =
        recordingUsers.get(roomId);

    if (chatRecordingUsers.has(userId)) {
        return;
    }

    chatRecordingUsers.add(userId);

    await emitTypingToParticipants(
        io,
        roomId,
        userId,
        "userRecording"
    );
};

const removeRecordingUser = async (
    io,
    chatId,
    userId
) => {

    const roomId = chatId.toString();

    const chatRecordingUsers =
        recordingUsers.get(roomId);

    if (
        !chatRecordingUsers ||
        !chatRecordingUsers.has(userId)
    ) {
        return;
    }

    chatRecordingUsers.delete(userId);

    await emitTypingToParticipants(
        io,
        roomId,
        userId,
        "userStoppedRecording"
    );

    if (chatRecordingUsers.size === 0) {
        recordingUsers.delete(roomId);
    }
};

// A user only becomes "reachable" once their socket connects, so anything
// sent while they were away is marked delivered (and their senders told)
// at that point — independently of whether read receipts are enabled.
const syncUndeliveredMessages = async (io, userId) => {
    try {
        const chats = await Chat.find({
            participants: userId,
        }).select("_id");

        if (chats.length === 0) {
            return;
        }

        const undeliveredMessages = await Message.find({
            chat: {
                $in: chats.map((chat) => chat._id),
            },
            sender: { $ne: userId },
            // Never "deliver" a message that was written while this user had
            // the sender blocked — the sender must stay on one tick.
            blockedFor: { $ne: userId },
            isDelivered: false,
        }).select("_id sender chat");

        if (undeliveredMessages.length === 0) {
            return;
        }

        const now = new Date();

        await Message.updateMany(
            {
                _id: {
                    $in: undeliveredMessages.map(
                        (message) => message._id
                    ),
                },
            },
            {
                $set: {
                    isDelivered: true,
                    deliveredAt: now,
                },
            }
        );

        undeliveredMessages.forEach((message) => {
            io.to(`user:${message.sender.toString()}`).emit(
                "messageDelivered",
                {
                    messageId: message._id.toString(),
                    chatId: message.chat.toString(),
                    deliveredAt: now,
                }
            );
        });

    } catch (error) {

        console.error(
            "Error syncing delivered messages:",
            error
        );

    }
};

const socketHandler = (io) => {

    User.updateMany(
        {},
        {
            isOnline: false,
            lastSeen: new Date(),
        }
    ).catch((error) => {

        console.error(
            "Error resetting online users:",
            error
        );

    });

    io.on("connection", async (socket) => {

        const userId =
            socket.userId.toString();

        console.log(
            "Socket connected:",
            socket.id
        );

        console.log(
            "User ID:",
            userId
        );

        socket.join(
            getUserRoom(userId)
        );

        const currentConnections =
            onlineUsers.get(userId) || 0;

        onlineUsers.set(
            userId,
            currentConnections + 1
        );

        try {

            const settings = await User.findById(userId)
                .select("onlineStatus");

            const presenceVisible = settings
                ? settings.onlineStatus !== false
                : true;

            await User.findByIdAndUpdate(
                userId,
                {
                    isOnline: presenceVisible,
                    lastSeen: presenceVisible
                        ? null
                        : new Date(),
                },
                {
                    new: true,
                }
            );

            console.log(
                "User is online:",
                userId,
                "presence visible:",
                presenceVisible
            );

            socket.emit(
                "onlineUsers",
                await getOnlineUserIds()
            );

            if (!presenceVisible) {

                sendUserStatus(
                    io,
                    userId,
                    false,
                    new Date()
                );

            } else if (currentConnections === 0) {

                sendUserStatus(
                    io,
                    userId,
                    true,
                    null
                );

            }

            await syncUndeliveredMessages(
                io,
                userId
            );

        } catch (error) {

            console.error(
                "Error updating online status:",
                error
            );

        }

        socket.on("setOnlineStatus", async (allowed) => {

            const visible = allowed !== false;

            try {

                await User.findByIdAndUpdate(
                    userId,
                    {
                        onlineStatus: visible,
                        isOnline: visible,
                        lastSeen: visible
                            ? null
                            : new Date(),
                    }
                );

                sendUserStatus(
                    io,
                    userId,
                    visible,
                    visible ? null : new Date()
                );

                io.emit(
                    "onlineUsers",
                    await getOnlineUserIds()
                );

            } catch (error) {

                console.error(
                    "Error updating presence setting:",
                    error
                );

            }

        });

        socket.on("joinChat", async (chatId) => {

            if (!chatId) {
                return;
            }

            const roomId =
                chatId.toString();

            socket.join(roomId);

            console.log(
                `User ${userId} joined chat room: ${roomId}`
            );

            const chatTypingUsers =
                typingUsers.get(roomId);

            const currentTypingUsers =
                chatTypingUsers
                    ? Array.from(chatTypingUsers)
                    : [];

            const chatRecordingUsers =
                recordingUsers.get(roomId);

            const currentRecordingUsers =
                chatRecordingUsers
                    ? Array.from(chatRecordingUsers)
                    : [];

            // Don't reveal that someone who blocked you is typing.
            const blockedTypingUserIds =
                await getBlockedParticipantIds(
                    [...currentTypingUsers, ...currentRecordingUsers],
                    userId
                );

            const visibleTypingUsers =
                currentTypingUsers.filter(
                    (typingUserId) =>
                        typingUserId !== userId &&
                        !blockedTypingUserIds.includes(
                            typingUserId
                        )
                );

            const visibleRecordingUsers =
                currentRecordingUsers.filter(
                    (recordingUserId) =>
                        recordingUserId !== userId &&
                        !blockedTypingUserIds.includes(
                            recordingUserId
                        )
                );

            socket.emit(
                "typingUsers",
                {
                    chatId: roomId,
                    userIds: visibleTypingUsers,
                    userNames: await Promise.all(
                        visibleTypingUsers.map((typingUserId) =>
                            getTypingUserName(typingUserId)
                        )
                    ),
                    recordingUserIds: visibleRecordingUsers,
                    recordingUserNames: await Promise.all(
                        visibleRecordingUsers.map((recordingUserId) =>
                            getTypingUserName(recordingUserId)
                        )
                    ),
                }
            );

            // Anyone opening the chat mid-call gets the "Join" banner.
            const liveGroupCall =
                getGroupCallForChat(roomId);

            if (liveGroupCall && liveGroupCall.joined.size > 0) {
                socket.emit(
                    "groupCall:state",
                    groupCallStatePayload(liveGroupCall)
                );
            }

        });

        socket.on("leaveChat", async (chatId) => {

            if (!chatId) {
                return;
            }

            const roomId =
                chatId.toString();

            await removeTypingUser(
                io,
                socket,
                roomId,
                userId
            );

            await removeRecordingUser(
                io,
                roomId,
                userId
            );

            socket.leave(roomId);

            console.log(
                `User ${userId} left chat room: ${roomId}`
            );

        });

        socket.on("typing", async (chatId) => {

            if (!chatId) {
                return;
            }

            await addTypingUser(
                io,
                socket,
                chatId,
                userId
            );

        });

        socket.on("stopTyping", async (chatId) => {

            if (!chatId) {
                return;
            }

            await removeTypingUser(
                io,
                socket,
                chatId,
                userId
            );

        });

        socket.on("recording", async (chatId) => {

            if (!chatId) {
                return;
            }

            await addRecordingUser(
                io,
                chatId,
                userId
            );

        });

        socket.on("stopRecording", async (chatId) => {

            if (!chatId) {
                return;
            }

            await removeRecordingUser(
                io,
                chatId,
                userId
            );

        });

        socket.on("goOffline", async () => {

            endCallForUser(io, userId);

            try {

                await User.findByIdAndUpdate(
                    userId,
                    {
                        isOnline: false,
                        lastSeen: new Date(),
                    }
                );

                console.log(
                    "User went offline:",
                    userId
                );

                sendUserStatus(
                    io,
                    userId,
                    false,
                    new Date()
                );

                io.emit(
                    "onlineUsers",
                    await getOnlineUserIds()
                );

            } catch (error) {

                console.error(
                    "Error marking user offline:",
                    error
                );

            }

        });

        // ---- Voice / video calling (WebRTC signalling relay) -------------
        // The server never touches media; it only relays the SDP offers,
        // answers and ICE candidates between the two participants.
        const forwardToUser = (targetId, event, payload) => {
            io.to(getUserRoom(targetId)).emit(event, payload);
        };

        socket.on("call:start", async (payload = {}) => {

            const { toUserId, chatId, callType, callId } = payload;

            if (!toUserId || !callId) {
                return;
            }

            const targetId = toUserId.toString();

            if (targetId === userId) {
                return;
            }

            if (!onlineUsers.has(targetId)) {
                socket.emit("call:failed", {
                    callId,
                    reason: "offline",
                });

                return;
            }

            if (busyUsers.has(targetId) || busyUsers.has(userId)) {
                socket.emit("call:failed", {
                    callId,
                    reason: "busy",
                });

                return;
            }

            try {

                const [target, self] = await Promise.all([
                    User.findById(targetId).select("blockedUsers"),
                    User.findById(userId).select(
                        "name username profilePicture blockedUsers"
                    ),
                ]);

                if (!target || !self) {
                    socket.emit("call:failed", {
                        callId,
                        reason: "offline",
                    });

                    return;
                }

                const targetBlockedMe = (target.blockedUsers || []).some(
                    (blockedId) => blockedId.toString() === userId
                );

                // Silent block — the caller must never learn they were blocked,
                // so the call just rings out on their side.
                if (targetBlockedMe) {
                    return;
                }

                const iBlockedThem = (self.blockedUsers || []).some(
                    (blockedId) => blockedId.toString() === targetId
                );

                if (iBlockedThem) {
                    socket.emit("call:failed", {
                        callId,
                        reason: "blocked",
                    });

                    return;
                }

                activeCalls.set(callId, {
                    callerId: userId,
                    calleeId: targetId,
                    chatId: chatId ? chatId.toString() : null,
                    callType: callType === "video" ? "video" : "audio",
                });

                busyUsers.set(userId, callId);
                busyUsers.set(targetId, callId);

                forwardToUser(targetId, "call:incoming", {
                    callId,
                    chatId: chatId ? chatId.toString() : null,
                    callType: callType === "video" ? "video" : "audio",
                    fromUserId: userId,
                    fromName: self.name || self.username || "Someone",
                    fromUsername: self.username || "",
                    fromProfilePicture: self.profilePicture || "",
                });

            } catch (error) {

                console.error("Error starting call:", error);

                socket.emit("call:failed", {
                    callId,
                    reason: "error",
                });

            }

        });

        socket.on("call:accept", ({ callId, toUserId } = {}) => {

            if (!callId || !toUserId) {
                return;
            }

            forwardToUser(toUserId.toString(), "call:accepted", {
                callId,
                fromUserId: userId,
            });

            // Close the ringing UI on this user's other tabs.
            socket.to(getUserRoom(userId)).emit("call:handled", {
                callId,
            });

        });

        socket.on("call:reject", ({ callId, toUserId } = {}) => {

            if (!callId || !toUserId) {
                return;
            }

            forwardToUser(toUserId.toString(), "call:rejected", {
                callId,
                fromUserId: userId,
            });

            socket.to(getUserRoom(userId)).emit("call:handled", {
                callId,
            });

            clearCall(callId);

        });

        socket.on("call:end", ({ callId, toUserId } = {}) => {

            if (!callId) {
                return;
            }

            if (toUserId) {
                forwardToUser(toUserId.toString(), "call:ended", {
                    callId,
                    fromUserId: userId,
                    reason: "ended",
                });
            }

            socket.to(getUserRoom(userId)).emit("call:ended", {
                callId,
                fromUserId: userId,
                reason: "ended",
            });

            clearCall(callId);

        });

        socket.on("call:offer", ({ callId, toUserId, sdp } = {}) => {

            if (!callId || !toUserId || !sdp) {
                return;
            }

            forwardToUser(toUserId.toString(), "call:offer", {
                callId,
                fromUserId: userId,
                sdp,
            });

        });

        socket.on("call:answer", ({ callId, toUserId, sdp } = {}) => {

            if (!callId || !toUserId || !sdp) {
                return;
            }

            forwardToUser(toUserId.toString(), "call:answer", {
                callId,
                fromUserId: userId,
                sdp,
            });

        });

        socket.on("call:ice", ({ callId, toUserId, candidate } = {}) => {

            if (!callId || !toUserId || !candidate) {
                return;
            }

            forwardToUser(toUserId.toString(), "call:ice", {
                callId,
                fromUserId: userId,
                candidate,
            });

        });

        // Lets the other side show a muted badge over the video.
        socket.on("call:mute", ({ callId, toUserId, muted } = {}) => {

            if (!callId || !toUserId) {
                return;
            }

            forwardToUser(toUserId.toString(), "call:muted", {
                callId,
                fromUserId: userId,
                muted: Boolean(muted),
            });

        });

        // ---- Group calls ---------------------------------------------------
        // Mesh topology: the server keeps the roster and relays offers,
        // answers and ICE. Every joined member talks directly to every other.

        const joinGroupSession = async (session) => {
            if (!session.participants.has(userId)) {
                socket.emit("groupCall:failed", {
                    callId: session.id,
                    reason: "not-member",
                });

                return false;
            }

            const currentCallId = busyUsers.get(userId);

            if (currentCallId && currentCallId !== session.id) {
                socket.emit("groupCall:failed", {
                    callId: session.id,
                    reason: "busy",
                });

                return false;
            }

            if (!session.joined.has(userId)) {
                const self = await getCallParticipantInfo(userId);

                if (!self) {
                    socket.emit("groupCall:failed", {
                        callId: session.id,
                        reason: "not-found",
                    });

                    return false;
                }

                session.joined.set(userId, self);

                for (const otherId of session.joined.keys()) {
                    if (otherId === userId) {
                        continue;
                    }

                    io.to(getUserRoom(otherId)).emit(
                        "groupCall:participantJoined",
                        {
                            callId: session.id,
                            user: self,
                        }
                    );
                }
            }

            busyUsers.set(userId, session.id);

            socket.emit("groupCall:participants", {
                callId: session.id,
                chatId: session.chatId,
                callType: session.callType,
                participants: Array.from(session.joined.values()),
                initiatorId: session.initiatorId,
                mutedUserIds: Array.from(session.muted || []),
            });

            emitGroupCallState(io, session);

            return true;
        };

        const relayGroupSignal = (event, payload = {}) => {
            const { callId, toUserId } = payload;

            if (!callId || !toUserId) {
                return;
            }

            const session = groupCalls.get(callId.toString());
            const targetId = toUserId.toString();

            if (
                !session ||
                !session.joined.has(userId) ||
                !session.joined.has(targetId)
            ) {
                return;
            }

            io.to(getUserRoom(targetId)).emit(event, {
                callId: session.id,
                fromUserId: userId,
                sdp: payload.sdp,
                candidate: payload.candidate,
            });
        };

        socket.on("groupCall:start", async ({ chatId, callType, callId } = {}) => {
            if (!chatId || !callId) {
                return;
            }

            try {
                const chat = await Chat.findById(chatId).select(
                    "participants isGroup groupName"
                );

                if (!chat || !chat.isGroup) {
                    socket.emit("groupCall:failed", {
                        callId,
                        reason: "not-found",
                    });

                    return;
                }

                if (
                    !chat.participants.some(
                        (participantId) =>
                            participantId.toString() === userId
                    )
                ) {
                    socket.emit("groupCall:failed", {
                        callId,
                        reason: "not-member",
                    });

                    return;
                }

                // Someone else already started one — join that instead of
                // ringing the whole group a second time.
                const existingCall = getGroupCallForChat(chatId);

                if (existingCall) {
                    await joinGroupSession(existingCall);
                    return;
                }

                const currentCallId = busyUsers.get(userId);

                if (currentCallId) {
                    socket.emit("groupCall:failed", {
                        callId,
                        reason: "busy",
                    });

                    return;
                }

                const self = await getCallParticipantInfo(userId);

                if (!self) {
                    socket.emit("groupCall:failed", {
                        callId,
                        reason: "not-found",
                    });

                    return;
                }

                const session = {
                    id: callId.toString(),
                    chatId: chatId.toString(),
                    callType:
                        callType === "video" ? "video" : "audio",
                    initiatorId: userId,
                    groupName: chat.groupName || "Group",
                    participants: new Set(
                        chat.participants.map((participantId) =>
                            participantId.toString()
                        )
                    ),
                    joined: new Map([[userId, self]]),
                    muted: new Set(),
                    startedAt: Date.now(),
                };

                groupCalls.set(session.id, session);
                busyUsers.set(userId, session.id);

                socket.emit("groupCall:participants", {
                    callId: session.id,
                    chatId: session.chatId,
                    callType: session.callType,
                    participants: Array.from(session.joined.values()),
                    initiatorId: session.initiatorId,
                    mutedUserIds: Array.from(session.muted || []),
                });

                const otherIds = Array.from(session.participants).filter(
                    (participantId) => participantId !== userId
                );
                const blockedIds = await getBlockedParticipantIds(
                    otherIds,
                    userId
                );

                for (const otherId of otherIds) {
                    if (blockedIds.includes(otherId)) {
                        continue;
                    }

                    io.to(getUserRoom(otherId)).emit("groupCall:incoming", {
                        callId: session.id,
                        chatId: session.chatId,
                        callType: session.callType,
                        groupName: session.groupName,
                        fromUserId: userId,
                        fromName: self.name,
                        fromUsername: self.username,
                        fromProfilePicture: self.profilePicture,
                        participantCount: session.participants.size,
                    });
                }

                emitGroupCallState(io, session);

            } catch (error) {
                console.error("Error starting group call:", error);

                socket.emit("groupCall:failed", {
                    callId,
                    reason: "error",
                });
            }
        });

        socket.on("groupCall:join", async ({ callId } = {}) => {
            const session = callId ? groupCalls.get(callId.toString()) : null;

            if (!session) {
                socket.emit("groupCall:failed", {
                    callId,
                    reason: "ended",
                });

                return;
            }

            await joinGroupSession(session);
        });

        socket.on("groupCall:decline", ({ callId } = {}) => {
            const session = callId ? groupCalls.get(callId.toString()) : null;

            if (!session || session.initiatorId === userId) {
                return;
            }

            io.to(getUserRoom(session.initiatorId)).emit(
                "groupCall:declined",
                {
                    callId: session.id,
                    userId,
                }
            );
        });

        socket.on("groupCall:leave", ({ callId } = {}) => {
            const session = callId ? groupCalls.get(callId.toString()) : null;

            leaveGroupCall(io, session, userId);
        });

        socket.on("groupCall:end", ({ callId } = {}) => {
            const session = callId ? groupCalls.get(callId.toString()) : null;

            if (!session || !session.joined.has(userId)) {
                return;
            }

            endGroupCall(io, session, "ended");
        });

        socket.on("groupCall:offer", (payload = {}) => {
            relayGroupSignal("groupCall:offer", payload);
        });

        socket.on("groupCall:answer", (payload = {}) => {
            relayGroupSignal("groupCall:answer", payload);
        });

        socket.on("groupCall:ice", (payload = {}) => {
            relayGroupSignal("groupCall:ice", payload);
        });

        // Mute state is a UI concern, but everyone needs it to show the badge.
        socket.on("groupCall:mute", ({ callId, muted } = {}) => {
            const session = callId ? groupCalls.get(callId.toString()) : null;

            if (!session || !session.joined.has(userId)) {
                return;
            }

            if (!session.muted) {
                session.muted = new Set();
            }

            if (muted) {
                session.muted.add(userId);
            } else {
                session.muted.delete(userId);
            }

            for (const otherId of session.joined.keys()) {
                if (otherId === userId) {
                    continue;
                }

                io.to(getUserRoom(otherId)).emit("groupCall:muted", {
                    callId: session.id,
                    userId,
                    muted: Boolean(muted),
                });
            }
        });

        socket.on("disconnect", async () => {

            console.log(
                "Socket disconnected:",
                socket.id
            );

            for (
                const [
                    chatId,
                    chatTypingUsers
                ]
                of typingUsers.entries()
            ) {

                if (
                    chatTypingUsers.has(userId)
                ) {

                    chatTypingUsers.delete(
                        userId
                    );

                    socket.to(chatId).emit(
                        "userStoppedTyping",
                        {
                            chatId,
                            userId,
                        }
                    );

                    await emitTypingToParticipants(
                        io,
                        chatId,
                        userId,
                        "userStoppedTyping"
                    );

                }

                if (
                    chatTypingUsers.size === 0
                ) {

                    typingUsers.delete(
                        chatId
                    );

                }

            }

            for (
                const [
                    chatId,
                    chatRecordingUsers
                ]
                of recordingUsers.entries()
            ) {

                if (
                    chatRecordingUsers.has(userId)
                ) {

                    chatRecordingUsers.delete(
                        userId
                    );

                    await emitTypingToParticipants(
                        io,
                        chatId,
                        userId,
                        "userStoppedRecording"
                    );

                }

                if (
                    chatRecordingUsers.size === 0
                ) {

                    recordingUsers.delete(
                        chatId
                    );

                }

            }

            const currentConnections =
                onlineUsers.get(userId) || 0;

            if (currentConnections > 1) {

                onlineUsers.set(
                    userId,
                    currentConnections - 1
                );

                return;
            }

            onlineUsers.delete(userId);

            endCallForUser(io, userId);

            try {

                await User.findByIdAndUpdate(
                    userId,
                    {
                        isOnline: false,
                        lastSeen: new Date(),
                    }
                );

                console.log(
                    "User is offline:",
                    userId
                );

                sendUserStatus(
                    io,
                    userId,
                    false,
                    new Date()
                );

                io.emit(
                    "onlineUsers",
                    await getOnlineUserIds()
                );

            } catch (error) {

                console.error(
                    "Error updating offline status:",
                    error
                );

            }

        });

    });
};

module.exports = socketHandler;
module.exports.getUserRoom = getUserRoom;