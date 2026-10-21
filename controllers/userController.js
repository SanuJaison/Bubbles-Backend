const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Report = require("../models/reportModel");
const jwt = require("jsonwebtoken");
const cloudinary = require("../config/cloudinary");
const { applyBlockSnapshots } = require("../utils/blockHelpers");

exports.registerUser = async (req, res, next) => {
    try {
        const { name, username, email, password } = req.body;

        if (!name || !username || !email || !password) {
            return res.status(400).json({ message: "All fields are required", });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters", });
        }

        const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() },], });

        if (existingUser) {
            if (existingUser.email === email.toLowerCase()) {
                return res.status(409).json({ message: "Email already exists", });
            }

            return res.status(409).json({ message: "Username already exists", });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name,
            username: username.toLowerCase(),
            email: email.toLowerCase(),
            password: hashedPassword,
        });

        await newUser.save();

        res.status(201).json({
            message: "User registered successfully",
            user: {
                id: newUser._id,
                name: newUser.name,
                username: newUser.username,
                email: newUser.email,
            },
        });
    } catch (error) {
        next(error);
    }
};

exports.loginUser = async (req, res, next) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({
                message: "Username/email and password are required",
            });
        }

        const user = await User.findOne({
            $or: [
                { email: identifier.toLowerCase() },
                { username: identifier.toLowerCase() },
            ],
        });

        if (!user) {
            return res.status(401).json({
                message: "Invalid username/email or password",
            });
        }

        const isPasswordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!isPasswordMatch) {
            return res.status(401).json({
                message: "Invalid username/email or password",
            });
        }

        const token = jwt.sign(
            {
                userId: user._id,
            },
            process.env.JWT_TOKEN,
            {
                expiresIn: "7d",
            }
        );

        res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                username: user.username,
                email: user.email,
                bio: user.bio,
                phone: user.phone,
                profilePicture: user.profilePicture,
                chatWallpaper: user.chatWallpaper,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen,
                enterToSend: user.enterToSend,
                messageNotifications: user.messageNotifications,
                notificationSound: user.notificationSound,
                readReceipts: user.readReceipts,
                onlineStatus: user.onlineStatus,
                profilePhotoVisibility: user.profilePhotoVisibility,
                lastSeenVisibility: user.lastSeenVisibility,
                blockedUsers: user.blockedUsers || [],
            },
        });
    } catch (error) {
        next(error);
    }
};

exports.getUserProfile = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id).select("-password");

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.status(200).json({
            message: "User profile fetched successfully",
            user
        });
    } catch (error) {
        next(error);
    }
}

exports.editUserProfile = async (req, res, next) => {
    try {
        const { name, username, bio, phone } = req.body;

        if (!name || !username) {
            return res.status(400).json({
                message: "Name and username are required"
            });
        }

        const existingUser = await User.findOne({
            username: username.toLowerCase(),
            _id: { $ne: req.user._id }
        });

        if (existingUser) {
            return res.status(409).json({
                message: "Username already exists"
            });
        }

        let profilePicture = req.user.profilePicture;

        if (req.file) {
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        folder: "bubbles/profile"
                    },
                    (error, result) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(result);
                        }
                    }
                );

                uploadStream.end(req.file.buffer);
            });

            profilePicture = uploadResult.secure_url;
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            {
                name,
                username: username.toLowerCase(),
                bio: bio || "",
                phone: phone || "",
                profilePicture
            },
            {
                new: true,
                runValidators: true
            }
        ).select("-password");

        if (!updatedUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.status(200).json({
            message: "Profile updated successfully",
            user: updatedUser
        });
    } catch (error) {
        next(error);
    }
};

exports.updateChatWallpaper = async (req, res, next) => {
    try {
        const { chatWallpaper } = req.body;

        let wallpaper = req.user.chatWallpaper;

        if (req.file) {
            if (!req.file.mimetype.startsWith("image/")) {
                return res.status(400).json({
                    message: "Wallpaper must be an image"
                });
            }

            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        folder: "bubbles/wallpapers"
                    },
                    (error, result) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(result);
                        }
                    }
                );

                uploadStream.end(req.file.buffer);
            });

            wallpaper = uploadResult.secure_url;
        } else if (chatWallpaper !== undefined) {
            wallpaper = chatWallpaper;
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            {
                chatWallpaper: wallpaper
            },
            {
                new: true
            }
        ).select("-password");

        if (!updatedUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.status(200).json({
            message: "Chat wallpaper updated successfully",
            user: updatedUser
        });
    } catch (error) {
        next(error);
    }
};

exports.changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                message: "Current and new password are required"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                message: "New password must be at least 6 characters"
            });
        }

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        if (!user.password) {
            return res.status(400).json({
                message: "This account does not use a password"
            });
        }

        const isMatch = await bcrypt.compare(
            currentPassword,
            user.password
        );

        if (!isMatch) {
            return res.status(401).json({
                message: "Current password is incorrect"
            });
        }

        user.password = await bcrypt.hash(newPassword, 10);

        await user.save();

        res.status(200).json({
            message: "Password updated successfully"
        });
    } catch (error) {
        next(error);
    }
};

exports.updateUserSettings = async (req, res, next) => {
    try {
        const allowedFields = [
            "enterToSend",
            "messageNotifications",
            "notificationSound",
            "readReceipts",
            "onlineStatus",
            "profilePhotoVisibility",
            "lastSeenVisibility",
        ];

        const updates = {};

        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                message: "No valid settings provided"
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            {
                new: true,
                runValidators: true
            }
        ).select("-password");

        if (!updatedUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.status(200).json({
            message: "Settings updated successfully",
            user: updatedUser
        });
    } catch (error) {
        next(error);
    }
};

exports.toggleBlockUser = async (req, res, next) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                message: "User ID is required"
            });
        }

        if (userId.toString() === req.user._id.toString()) {
            return res.status(400).json({
                message: "You cannot block yourself"
            });
        }

        const targetUser = await User.findById(userId).select("_id");

        if (!targetUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const currentUser = await User.findById(req.user._id);

        if (!currentUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const isBlocked = currentUser.blockedUsers.some(
            (blockedUserId) =>
                blockedUserId.toString() === userId.toString()
        );

        if (isBlocked) {
            currentUser.blockedUsers = currentUser.blockedUsers.filter(
                (blockedUserId) =>
                    blockedUserId.toString() !== userId.toString()
            );

            currentUser.blockedSnapshots = (
                currentUser.blockedSnapshots || []
            ).filter(
                (entry) =>
                    !entry.user ||
                    entry.user.toString() !== userId.toString()
            );
        } else {
            currentUser.blockedUsers.push(userId);

            // Freeze what this user looks like for the blocked person, so
            // later profile edits stay invisible to them.
            currentUser.blockedSnapshots.push({
                user: userId,
                name: currentUser.name || "",
                username: currentUser.username || "",
                profilePicture: currentUser.profilePicture || "",
                bio: currentUser.bio || "",
                lastSeen: currentUser.lastSeen || null,
                isOnline: currentUser.isOnline || false
            });
        }

        await currentUser.save();

        const updatedUser = await User.findById(req.user._id).select(
            "-password"
        );

        res.status(200).json({
            message: isBlocked
                ? "User unblocked successfully"
                : "User blocked successfully",
            blocked: !isBlocked,
            user: updatedUser
        });
    } catch (error) {
        next(error);
    }
};

exports.getAllUsers = async (req, res, next) => {
    try {
        const users = await User.find({
            _id: { $ne: req.user._id }
        })
            .select(
                "name username profilePicture bio isOnline lastSeen onlineStatus profilePhotoVisibility lastSeenVisibility blockedUsers blockedSnapshots"
            )
            .sort({ name: 1 });

        // Anyone who has the requester blocked shows their frozen profile.
        applyBlockSnapshots(users, req.user._id);

        res.status(200).json({
            message: "Users fetched successfully",
            users
        });
    } catch (error) {
        next(error);
    }
};
// ── Reporting ────────────────────────────────────────────────────────────────
// A report is stored for the team to review; the reported user is never told
// who reported them or that a report exists.
exports.reportUser = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { reason, details = "", chatId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                message: "Invalid user"
            });
        }

        if (String(userId) === String(req.user._id)) {
            return res.status(400).json({
                message: "You can't report yourself"
            });
        }

        const trimmedReason = String(reason || "").trim();

        if (!trimmedReason) {
            return res.status(400).json({
                message: "Please choose a reason for the report"
            });
        }

        const reportedUser = await User.findById(userId).select("_id");

        if (!reportedUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // A report filed in the last minute for the same person is treated as
        // a double tap rather than a second report.
        const recentReport = await Report.findOne({
            reporter: req.user._id,
            reportedUser: userId,
            createdAt: {
                $gte: new Date(Date.now() - 60 * 1000)
            }
        });

        if (recentReport) {
            return res.status(200).json({
                message: "You already reported this user. Our team is on it.",
                report: {
                    id: recentReport._id,
                    status: recentReport.status
                }
            });
        }

        const report = await Report.create({
            reporter: req.user._id,
            reportedUser: userId,
            chat:
                chatId && mongoose.Types.ObjectId.isValid(chatId)
                    ? chatId
                    : null,
            reason: trimmedReason.slice(0, 80),
            details: String(details).trim().slice(0, 1000)
        });

        res.status(201).json({
            message: "Report submitted. Thanks for letting us know.",
            report: {
                id: report._id,
                status: report.status
            }
        });
    } catch (error) {
        next(error);
    }
};
