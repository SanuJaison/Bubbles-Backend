const User = require("../models/userModel");
const Chat = require("../models/chatModel");
const Message = require("../models/messageModel");
const Feedback = require("../models/feedbackModel");
const {
    getConnectedUserIds,
} = require("../sockets/socketHandler");
const {
    asTrimmedString,
    normalizeEmail,
    stripControlChars,
} = require("../utils/validation");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 50;

const FEEDBACK_CATEGORIES = ["suggestion", "bug", "feature", "other"];
const FEEDBACK_STATUSES = ["new", "reviewed", "archived"];
const DEVICE_TYPES = ["desktop", "mobile", "tablet", "unknown"];

const connectedIds = () =>
    typeof getConnectedUserIds === "function" ? getConnectedUserIds() : [];

const escapeRegex = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPagination = (query = {}) => {
    const rawPage = Number.parseInt(query.page, 10);
    const rawLimit = Number.parseInt(query.limit, 10);
    const page = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), 10000) : 1;
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE)
        : 20;

    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
};

const buildCountMap = (rows, keys) => {
    const counts = Object.fromEntries(keys.map((key) => [key, 0]));

    rows.forEach((row) => {
        if (Object.prototype.hasOwnProperty.call(counts, row._id)) {
            counts[row._id] = row.count;
        }
    });

    return counts;
};

const buildSignupSeries = (rows, days = 14) => {
    const counts = new Map(rows.map((row) => [row._id, row.count]));
    const now = new Date();
    const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const series = [];

    for (let index = days - 1; index >= 0; index -= 1) {
        const date = new Date(end.getTime() - index * DAY_MS);
        const key = date.toISOString().slice(0, 10);

        series.push({
            date: key,
            count: counts.get(key) || 0,
        });
    }

    return series;
};

const decorateUser = (user, onlineSet, includePrivate = false) => {
    const devices = (Array.isArray(user.devices) ? user.devices : [])
        .map((device) => ({
            type: DEVICE_TYPES.includes(device.type)
                ? device.type
                : "unknown",
            os: device.os || "",
            browser: device.browser || "",
            lastActiveAt: device.lastActiveAt || device.firstSeenAt || null,
            firstSeenAt: device.firstSeenAt || null,
            ...(includePrivate
                ? {
                      ip: device.ip || "",
                      userAgent: device.userAgent || "",
                  }
                : {}),
        }))
        .sort(
            (left, right) =>
                new Date(right.lastActiveAt || 0).getTime() -
                new Date(left.lastActiveAt || 0).getTime()
        );

    const lastActiveAt =
        devices[0]?.lastActiveAt ||
        user.lastSeen ||
        user.createdAt ||
        null;

    const result = {
        _id: String(user._id),
        name: user.name || "",
        username: user.username || "",
        email: user.email || "",
        profilePicture: user.profilePicture || "",
        isOnline: onlineSet.has(String(user._id)),
        lastSeen: user.lastSeen || null,
        createdAt: user.createdAt || null,
        devices,
        deviceCount: devices.length,
        lastActiveAt,
        emailVerified: user.emailVerified !== false,
        isGoogle: Boolean(user.googleId),
    };

    if (includePrivate) {
        result.bio = user.bio || "";
        result.phone = user.phone || "";
        result.needsUsername = Boolean(user.needsUsername);
        result.onlineStatus = user.onlineStatus !== false;
        result.lastSeenVisibility = user.lastSeenVisibility || "everyone";
        result.updatedAt = user.updatedAt || null;
    }

    return result;
};

const serializeFeedback = (feedback) => ({
    _id: String(feedback._id),
    name: feedback.name || "",
    email: feedback.email || "",
    category: feedback.category || "suggestion",
    message: feedback.message || "",
    page: feedback.page || "",
    source: feedback.source || "web",
    status: feedback.status || "new",
    createdAt: feedback.createdAt || null,
    updatedAt: feedback.updatedAt || null,
});

exports.getMe = async (req, res) => {
    res.status(200).json({
        success: true,
        admin: {
            _id: String(req.user._id),
            name: req.user.name || "",
            username: req.user.username || "",
            email: req.user.email || "",
            profilePicture: req.user.profilePicture || "",
        },
    });
};

exports.getOverview = async (req, res, next) => {
    try {
        const now = new Date();
        const since24h = new Date(now.getTime() - DAY_MS);
        const since7d = new Date(now.getTime() - 7 * DAY_MS);
        const since30d = new Date(now.getTime() - 30 * DAY_MS);
        const seriesStart = new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate()
            ) - 13 * DAY_MS
        );
        const onlineIds = connectedIds();
        const onlineSet = new Set(onlineIds);

        const [
            totalUsers,
            verifiedUsers,
            googleUsers,
            newUsers24h,
            newUsers7d,
            newUsers30d,
            active24h,
            totalFeedback,
            newFeedback24h,
            newFeedback7d,
            newFeedbackTotal,
            totalChats,
            groupChats,
            totalMessages,
            messages24h,
            totalCalls,
            signupRows,
            feedbackCategoryRows,
            feedbackStatusRows,
            deviceRows,
            recentUsers,
            recentFeedback,
        ] = await Promise.all([
            User.countDocuments({}),
            User.countDocuments({ emailVerified: { $ne: false } }),
            User.countDocuments({ googleId: { $exists: true, $ne: "" } }),
            User.countDocuments({ createdAt: { $gte: since24h } }),
            User.countDocuments({ createdAt: { $gte: since7d } }),
            User.countDocuments({ createdAt: { $gte: since30d } }),
            User.countDocuments({
                $or: [
                    { lastSeen: { $gte: since24h } },
                    { _id: { $in: onlineIds } },
                ],
            }),
            Feedback.countDocuments({}),
            Feedback.countDocuments({ createdAt: { $gte: since24h } }),
            Feedback.countDocuments({ createdAt: { $gte: since7d } }),
            Feedback.countDocuments({ status: "new" }),
            Chat.countDocuments({}),
            Chat.countDocuments({ isGroup: true }),
            Message.countDocuments({ isDeleted: { $ne: true } }),
            Message.countDocuments({
                isDeleted: { $ne: true },
                createdAt: { $gte: since24h },
            }),
            Message.countDocuments({
                isDeleted: { $ne: true },
                messageType: "call",
            }),
            User.aggregate([
                { $match: { createdAt: { $gte: seriesStart } } },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: "%Y-%m-%d",
                                date: "$createdAt",
                                timezone: "UTC",
                            },
                        },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            Feedback.aggregate([
                {
                    $group: {
                        _id: "$category",
                        count: { $sum: 1 },
                    },
                },
            ]),
            Feedback.aggregate([
                {
                    $group: {
                        _id: "$status",
                        count: { $sum: 1 },
                    },
                },
            ]),
            User.aggregate([
                { $match: { "devices.0": { $exists: true } } },
                { $unwind: "$devices" },
                {
                    $group: {
                        _id: "$devices.type",
                        users: { $addToSet: "$_id" },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        type: "$_id",
                        count: { $size: "$users" },
                    },
                },
            ]),
            User.find({})
                .select(
                    "name username email profilePicture isOnline lastSeen createdAt devices googleId emailVerified"
                )
                .sort({ createdAt: -1 })
                .limit(6)
                .lean(),
            Feedback.find({})
                .sort({ createdAt: -1 })
                .limit(6)
                .lean(),
        ]);

        const categoryCounts = buildCountMap(
            feedbackCategoryRows,
            FEEDBACK_CATEGORIES
        );
        const statusCounts = buildCountMap(
            feedbackStatusRows,
            FEEDBACK_STATUSES
        );
        const deviceCounts = buildCountMap(deviceRows, DEVICE_TYPES);

        res.status(200).json({
            success: true,
            overview: {
                generatedAt: now,
                totals: {
                    users: totalUsers,
                    verifiedUsers,
                    googleUsers,
                    onlineUsers: onlineIds.length,
                    active24h,
                    newUsers24h,
                    newUsers7d,
                    newUsers30d,
                    feedback: totalFeedback,
                    newFeedback: newFeedbackTotal,
                    newFeedback24h,
                    newFeedback7d,
                    chats: totalChats,
                    groups: groupChats,
                    messages: totalMessages,
                    messages24h,
                    calls: totalCalls,
                },
                signupSeries: buildSignupSeries(signupRows, 14),
                feedbackByCategory: FEEDBACK_CATEGORIES.map((category) => ({
                    category,
                    count: categoryCounts[category] || 0,
                })),
                feedbackByStatus: FEEDBACK_STATUSES.map((status) => ({
                    status,
                    count: statusCounts[status] || 0,
                })),
                deviceBreakdown: DEVICE_TYPES.map((type) => ({
                    type,
                    count: deviceCounts[type] || 0,
                })),
                recentUsers: recentUsers.map((user) =>
                    decorateUser(user, onlineSet)
                ),
                recentFeedback: recentFeedback.map(serializeFeedback),
            },
        });
    } catch (error) {
        next(error);
    }
};

exports.getUsers = async (req, res, next) => {
    try {
        const { page, limit, skip } = getPagination(req.query);
        const onlineIds = connectedIds();
        const onlineSet = new Set(onlineIds);
        const filter = {};
        const search = stripControlChars(req.query.search).slice(0, 80);
        const status = asTrimmedString(req.query.status).toLowerCase();
        const device = asTrimmedString(req.query.device).toLowerCase();

        if (search) {
            const regex = new RegExp(escapeRegex(search), "i");

            filter.$or = [
                { name: regex },
                { username: regex },
                { email: regex },
            ];
        }

        if (status === "online") {
            filter._id = { $in: onlineIds };
        } else if (status === "offline") {
            filter._id = { $nin: onlineIds };
        }

        if (DEVICE_TYPES.includes(device)) {
            filter["devices.type"] = device;
        }

        const sort = asTrimmedString(req.query.sort).toLowerCase();
        const sortQuery =
            sort === "oldest"
                ? { createdAt: 1 }
                : sort === "name"
                  ? { name: 1, createdAt: -1 }
                  : sort === "active"
                    ? { lastSeen: -1, createdAt: -1 }
                    : { createdAt: -1 };

        const [total, users] = await Promise.all([
            User.countDocuments(filter),
            User.find(filter)
                .select(
                    "name username email profilePicture isOnline lastSeen createdAt devices googleId emailVerified"
                )
                .sort(sortQuery)
                .skip(skip)
                .limit(limit)
                .lean(),
        ]);

        res.status(200).json({
            success: true,
            users: users.map((user) => decorateUser(user, onlineSet)),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit) || 0,
            },
        });
    } catch (error) {
        next(error);
    }
};

exports.getUser = async (req, res, next) => {
    try {
        const onlineSet = new Set(connectedIds());
        const user = await User.findById(req.params.userId)
            .select(
                "name username email profilePicture bio phone isOnline lastSeen createdAt updatedAt devices googleId emailVerified needsUsername onlineStatus lastSeenVisibility"
            )
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        const [chats, groups, messages, calls, feedback] = await Promise.all([
            Chat.countDocuments({ participants: user._id }),
            Chat.countDocuments({ participants: user._id, isGroup: true }),
            Message.countDocuments({
                sender: user._id,
                isDeleted: { $ne: true },
            }),
            Message.countDocuments({
                sender: user._id,
                isDeleted: { $ne: true },
                messageType: "call",
            }),
            user.email
                ? Feedback.countDocuments({
                      email: normalizeEmail(user.email),
                  })
                : 0,
        ]);

        res.status(200).json({
            success: true,
            user: decorateUser(user, onlineSet, true),
            stats: {
                chats,
                groups,
                messages,
                calls,
                feedback,
            },
        });
    } catch (error) {
        next(error);
    }
};

exports.getFeedback = async (req, res, next) => {
    try {
        const { page, limit, skip } = getPagination(req.query);
        const filter = {};
        const search = stripControlChars(req.query.search).slice(0, 80);
        const category = asTrimmedString(req.query.category).toLowerCase();
        const status = asTrimmedString(req.query.status).toLowerCase();

        if (search) {
            const regex = new RegExp(escapeRegex(search), "i");

            filter.$or = [
                { name: regex },
                { email: regex },
                { message: regex },
            ];
        }

        if (FEEDBACK_CATEGORIES.includes(category)) {
            filter.category = category;
        }

        if (FEEDBACK_STATUSES.includes(status)) {
            filter.status = status;
        }

        const [total, feedback, statusRows, categoryRows] = await Promise.all([
            Feedback.countDocuments(filter),
            Feedback.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Feedback.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            Feedback.aggregate([
                { $group: { _id: "$category", count: { $sum: 1 } } },
            ]),
        ]);

        const byStatus = buildCountMap(statusRows, FEEDBACK_STATUSES);
        const byCategory = buildCountMap(
            categoryRows,
            FEEDBACK_CATEGORIES
        );

        res.status(200).json({
            success: true,
            feedback: feedback.map(serializeFeedback),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit) || 0,
            },
            summary: {
                total: Object.values(byStatus).reduce(
                    (sum, count) => sum + count,
                    0
                ),
                byStatus,
                byCategory,
            },
        });
    } catch (error) {
        next(error);
    }
};

exports.updateFeedbackStatus = async (req, res, next) => {
    try {
        const status = asTrimmedString(req.body?.status).toLowerCase();

        if (!FEEDBACK_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Choose a valid feedback status.",
            });
        }

        const feedback = await Feedback.findByIdAndUpdate(
            req.params.feedbackId,
            { status },
            { new: true, runValidators: true }
        ).lean();

        if (!feedback) {
            return res.status(404).json({
                success: false,
                message: "Feedback not found",
            });
        }

        res.status(200).json({
            success: true,
            feedback: serializeFeedback(feedback),
        });
    } catch (error) {
        next(error);
    }
};
