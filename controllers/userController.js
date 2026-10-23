const bcrypt = require("bcrypt");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/userModel");
const Report = require("../models/reportModel");
const cloudinary = require("../config/cloudinary");
const { applyBlockSnapshots } = require("../utils/blockHelpers");
const { signAuthToken } = require("../utils/authTokens");
const {
    isEmailConfigured,
    sendEmailVerificationEmail,
    sendPasswordResetEmail,
} = require("../utils/mailer");
const {
    DISALLOWED_EMAIL_MESSAGE,
    isDisallowedEmail,
} = require("../utils/emailPolicy");
const {
    asTrimmedString,
    stripControlChars,
    normalizeUsername,
    normalizeEmail,
    isValidUsername,
    isValidEmail,
    getPasswordProblem,
    isValidHttpUrl,
} = require("../utils/validation");
const {
    getRequestDeviceDetails,
    recordUserDevice,
} = require("../utils/deviceInfo");

const PASSWORD_COST = 12;
// Comparing against a real hash when the account does not exist keeps the
// response time similar, so an attacker cannot enumerate usernames.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
    "bubbles-invalid-password-placeholder",
    PASSWORD_COST
);

const googleClient = new OAuth2Client();

const PASSWORD_RESET_MINUTES = Math.min(
    120,
    Math.max(5, Number(process.env.PASSWORD_RESET_MINUTES) || 30)
);

const EMAIL_VERIFICATION_MINUTES = Math.min(
    1440,
    Math.max(15, Number(process.env.EMAIL_VERIFICATION_MINUTES) || 1440)
);

// Raw tokens are only ever sent by email. The database keeps a SHA-256
// digest, so a database leak cannot be used to verify or reset accounts.
const hashToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

const createEmailVerificationToken = (user) => {
    const rawToken = crypto.randomBytes(32).toString("hex");

    user.emailVerificationToken = hashToken(rawToken);
    user.emailVerificationExpires = new Date(
        Date.now() + EMAIL_VERIFICATION_MINUTES * 60 * 1000
    );
    user.emailVerificationSentAt = new Date();

    return rawToken;
};

const buildPublicUser = (user) => ({
    _id: user._id,
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
    needsUsername: Boolean(user.needsUsername),
});

// Device tracking is useful for the admin area, but it must never make a
// successful sign-in fail. The user is already authenticated at this point.
const rememberDevice = async (user, req) => {
    try {
        await recordUserDevice(user, getRequestDeviceDetails(req));
    } catch (error) {
        console.error("Could not record user device:", error.message);
    }
};

const getClientOrigin = () => {
    const configured =
        process.env.PASSWORD_RESET_URL ||
        process.env.CLIENT_URLS ||
        process.env.CLIENT_URL ||
        "http://localhost:5173";
    const firstOrigin = String(configured)
        .split(",")[0]
        .trim()
        .replace(/\/+$/, "");

    try {
        return new URL(firstOrigin).origin;
    } catch {
        return "http://localhost:5173";
    }
};

const buildVerificationUrl = (rawToken, email) =>
    `${getClientOrigin()}/verify-email/${rawToken}?email=${encodeURIComponent(
        email
    )}`;

// HTTP tokens are invalidated by tokenVersion. Closing the user's live
// sockets at the same time avoids leaving an already-connected tab with a
// usable realtime session after a password change or reset.
const disconnectUserSockets = (req, userId) => {
    const io = req.app.get("io");

    if (io) {
        io.in(`user:${userId}`).disconnectSockets(true);
    }
};

const makeUsernameBase = (email, name) => {
    const fromEmail = String(email || "")
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, "")
        .replace(/^[._]+|[._]+$/g, "")
        .slice(0, 20);

    const fromName = String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 20);

    const base = fromEmail || fromName || "bubbles";

    return base.length >= 3 ? base : `${base}user`.slice(0, 20);
};

// Google does not hand us a username, but the schema needs a unique one
// before the person can finish onboarding. This temporary value is replaced
// on the choose-username screen.
const createTemporaryUsername = async (email, name) => {
    const base = makeUsernameBase(email, name);

    for (let attempt = 0; attempt < 12; attempt += 1) {
        const suffix = crypto.randomInt(100000, 999999);
        const candidate = `${base}.${suffix}`.slice(0, 32);
        const exists = await User.exists({ username: candidate });

        if (!exists) {
            return candidate;
        }
    }

    // Practically unreachable, but keeps the account creation deterministic.
    return `user.${crypto.randomBytes(8).toString("hex")}`.slice(0, 32);
};

exports.registerUser = async (req, res, next) => {
    try {
        const name = stripControlChars(req.body?.name);
        const username = normalizeUsername(req.body?.username);
        const email = normalizeEmail(req.body?.email);
        const password =
            typeof req.body?.password === "string" ? req.body.password : "";

        if (!name || !username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required",
            });
        }

        if (name.length < 2 || name.length > 80) {
            return res.status(400).json({
                success: false,
                message: "Name must be between 2 and 80 characters",
            });
        }

        if (!isValidUsername(username)) {
            return res.status(400).json({
                success: false,
                message:
                    "Username must be 3-32 characters and use letters, numbers, dots, or underscores",
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address",
            });
        }

        if (isDisallowedEmail(email)) {
            return res.status(400).json({
                success: false,
                message: DISALLOWED_EMAIL_MESSAGE,
            });
        }

        const passwordProblem = getPasswordProblem(password);

        if (passwordProblem) {
            return res.status(400).json({
                success: false,
                message: passwordProblem,
            });
        }

        const existingUser = await User.findOne({
            $or: [{ email }, { username }],
        }).select("_id");

        if (existingUser) {
            // Deliberately identical for email and username so registration
            // cannot be used to confirm which one another person owns.
            return res.status(409).json({
                success: false,
                message: "An account with that email or username already exists",
            });
        }

        if (!isEmailConfigured()) {
            return res.status(503).json({
                success: false,
                message:
                    "Registration is temporarily unavailable because email verification is not configured.",
            });
        }

        const hashedPassword = await bcrypt.hash(password, PASSWORD_COST);

        const newUser = new User({
            name,
            username,
            email,
            password: hashedPassword,
            emailVerified: false,
        });
        const rawVerificationToken = createEmailVerificationToken(newUser);

        await newUser.save();

        try {
            await sendEmailVerificationEmail({
                to: newUser.email,
                name: newUser.name,
                verifyUrl: buildVerificationUrl(
                    rawVerificationToken,
                    newUser.email
                ),
                expiresMinutes: EMAIL_VERIFICATION_MINUTES,
            });
        } catch (error) {
            console.error(
                "Verification email could not be sent:",
                error.message
            );

            // Do not leave an account that can never be verified behind.
            await User.deleteOne({ _id: newUser._id }).catch(() => {});

            return res.status(503).json({
                success: false,
                message:
                    "We couldn't send the verification email. Please try again in a moment.",
            });
        }

        await rememberDevice(newUser, req);

        res.status(201).json({
            message:
                "Account created. Check your email to verify it before signing in.",
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
        const identifier =
            typeof req.body?.identifier === "string"
                ? req.body.identifier.trim().toLowerCase()
                : "";
        const password =
            typeof req.body?.password === "string" ? req.body.password : "";

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Username/email and password are required",
            });
        }

        if (identifier.length > 254 || password.length > 128) {
            return res.status(401).json({
                success: false,
                message: "Invalid username/email or password",
            });
        }

        const user = await User.findOne({
            $or: [{ email: identifier }, { username: identifier }],
        });

        if (!user || !user.password) {
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);

            return res.status(401).json({
                success: false,
                message: "Invalid username/email or password",
            });
        }

        const isPasswordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!isPasswordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid username/email or password",
            });
        }

        // These checks deliberately run after the password comparison so they
        // cannot be used to learn anything about an account without its
        // password.
        if (isDisallowedEmail(user.email)) {
            return res.status(403).json({
                success: false,
                code: "EMAIL_DOMAIN_BLOCKED",
                message:
                    "This email domain isn't supported. Please use a permanent email address.",
            });
        }

        if (user.emailVerified === false) {
            return res.status(403).json({
                success: false,
                code: "EMAIL_NOT_VERIFIED",
                email: user.email,
                message:
                    "Verify your email before signing in. Check your inbox for the verification link.",
            });
        }

        // Upgrade older hashes the next time the owner signs in.
        if (bcrypt.getRounds(user.password) < PASSWORD_COST) {
            user.password = await bcrypt.hash(password, PASSWORD_COST);
            await user.save();
        }

        await rememberDevice(user, req);

        const token = signAuthToken(user._id, user.tokenVersion);

        res.status(200).json({
            message: "Login successful",
            token,
            user: buildPublicUser(user),
        });
    } catch (error) {
        next(error);
    }
};

exports.googleAuth = async (req, res, next) => {
    try {
        const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
        const credential =
            typeof req.body?.credential === "string"
                ? req.body.credential.trim()
                : "";

        if (!clientId) {
            return res.status(503).json({
                success: false,
                message: "Google sign-in is not configured yet",
            });
        }

        if (!credential || credential.length > 4096) {
            return res.status(400).json({
                success: false,
                message: "Google sign-in could not be completed",
            });
        }

        let payload;

        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: clientId,
            });

            payload = ticket.getPayload();
        } catch {
            return res.status(401).json({
                success: false,
                message: "Google sign-in could not be verified",
            });
        }

        const email = normalizeEmail(payload?.email);
        const googleId = String(payload?.sub || "").slice(0, 255);

        if (
            !googleId ||
            !isValidEmail(email) ||
            payload?.email_verified !== true
        ) {
            return res.status(401).json({
                success: false,
                message: "Your Google email could not be verified",
            });
        }

        let user = await User.findOne({ googleId });

        if (!user) {
            user = await User.findOne({ email });
        }

        if (user) {
            if (user.googleId && user.googleId !== googleId) {
                return res.status(409).json({
                    success: false,
                    message: "This email is linked to another Google account",
                });
            }

            // Never silently attach Google to a password account. Otherwise
            // someone could pre-register another person's email and then share
            // the Google-created session. The owner can sign in with their
            // password and link later, or reset it from their inbox.
            if (!user.googleId && user.password) {
                return res.status(409).json({
                    success: false,
                    message:
                        "An account with this email already exists. Sign in with your password instead, or use Forgot Password.",
                });
            }

            let changed = false;

            if (!user.googleId) {
                user.googleId = googleId;
                changed = true;
            }

            // Google has already verified ownership of the address.
            if (user.emailVerified === false) {
                user.emailVerified = true;
                user.emailVerificationToken = undefined;
                user.emailVerificationExpires = undefined;
                user.emailVerificationSentAt = undefined;
                changed = true;
            }

            if (
                !user.profilePicture &&
                isValidHttpUrl(payload?.picture)
            ) {
                user.profilePicture = payload.picture;
                changed = true;
            }

            if (changed) {
                await user.save();
            }
        } else {
            const name =
                stripControlChars(payload?.name).slice(0, 80) ||
                email.split("@")[0] ||
                "Bubbles User";

            user = await User.create({
                name,
                username: await createTemporaryUsername(email, name),
                email,
                googleId,
                emailVerified: true,
                profilePicture: isValidHttpUrl(payload?.picture)
                    ? payload.picture
                    : "",
                needsUsername: true,
            });
        }

        await rememberDevice(user, req);

        const token = signAuthToken(user._id, user.tokenVersion);

        return res.status(200).json({
            message: user.needsUsername
                ? "Choose a username to finish setting up your account"
                : "Google sign-in successful",
            token,
            user: buildPublicUser(user),
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
            user: buildPublicUser(user)
        });
    } catch (error) {
        next(error);
    }
}

exports.recordDevice = async (req, res, next) => {
    try {
        await recordUserDevice(req.user, getRequestDeviceDetails(req));

        res.status(200).json({
            success: true,
            message: "Device updated",
        });
    } catch (error) {
        next(error);
    }
};

exports.editUserProfile = async (req, res, next) => {
    try {
        const name = stripControlChars(req.body?.name);
        const username = normalizeUsername(req.body?.username);
        const bio =
            typeof req.body?.bio === "string"
                ? stripControlChars(req.body.bio)
                : "";
        const phone =
            typeof req.body?.phone === "string"
                ? stripControlChars(req.body.phone)
                : "";

        if (!name || !username) {
            return res.status(400).json({
                success: false,
                message: "Name and username are required"
            });
        }

        if (name.length < 2 || name.length > 80) {
            return res.status(400).json({
                success: false,
                message: "Name must be between 2 and 80 characters"
            });
        }

        if (!isValidUsername(username)) {
            return res.status(400).json({
                success: false,
                message:
                    "Username must be 3-32 characters and use letters, numbers, dots, or underscores"
            });
        }

        if (bio.length > 500) {
            return res.status(400).json({
                success: false,
                message: "Bio must be 500 characters or fewer"
            });
        }

        if (phone.length > 30) {
            return res.status(400).json({
                success: false,
                message: "Phone number is too long"
            });
        }

        const existingUser = await User.findOne({
            username,
            _id: { $ne: req.user._id }
        }).select("_id");

        if (existingUser) {
            return res.status(409).json({
                success: false,
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
                username,
                bio,
                phone,
                profilePicture
            },
            {
                returnDocument: "after",
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
            user: buildPublicUser(updatedUser)
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
            const nextWallpaper =
                typeof chatWallpaper === "string"
                    ? chatWallpaper.trim()
                    : "";

            const isPreset = /^preset:[a-z0-9_-]{1,40}$/i.test(
                nextWallpaper
            );

            if (
                !isPreset &&
                !isValidHttpUrl(nextWallpaper)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Choose a valid wallpaper",
                });
            }

            wallpaper = nextWallpaper;
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            {
                chatWallpaper: wallpaper
            },
            {
                returnDocument: "after"
            }
        ).select("-password");

        if (!updatedUser) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.status(200).json({
            message: "Chat wallpaper updated successfully",
            user: buildPublicUser(updatedUser)
        });
    } catch (error) {
        next(error);
    }
};

exports.changePassword = async (req, res, next) => {
    try {
        const newPassword =
            typeof req.body?.newPassword === "string"
                ? req.body.newPassword
                : "";

        if (!newPassword) {
            return res.status(400).json({
                success: false,
                message: "Enter a new password",
            });
        }

        const passwordProblem = getPasswordProblem(newPassword);

        if (passwordProblem) {
            return res.status(400).json({
                success: false,
                message: passwordProblem,
            });
        }

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        // We deliberately do not ask for the old password: people use this
        // screen when they no longer remember it. The authenticated session is
        // the proof of ownership, and reusing the old password is blocked.
        if (user.password) {
            const isSamePassword = await bcrypt.compare(
                newPassword,
                user.password
            );

            if (isSamePassword) {
                return res.status(400).json({
                    success: false,
                    message:
                        "You cannot use your current password as the new password",
                });
            }
        }

        user.password = await bcrypt.hash(newPassword, PASSWORD_COST);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        user.tokenVersion = (user.tokenVersion || 0) + 1;

        await user.save();
        disconnectUserSockets(req, user._id);

        // The token that made this request now has an old version. Return a
        // fresh one so the person changing their own password stays signed in
        // while every other session is invalidated.
        res.status(200).json({
            message: "Password updated successfully",
            token: signAuthToken(user._id, user.tokenVersion),
        });
    } catch (error) {
        next(error);
    }
};

exports.chooseUsername = async (req, res, next) => {
    try {
        const username = normalizeUsername(req.body?.username);

        if (!isValidUsername(username)) {
            return res.status(400).json({
                success: false,
                message:
                    "Username must be 3-32 characters and use letters, numbers, dots, or underscores",
            });
        }

        const existingUser = await User.findOne({
            username,
            _id: { $ne: req.user._id },
        }).select("_id");

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "That username is already taken",
            });
        }

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        user.username = username;
        user.needsUsername = false;

        try {
            await user.save();
        } catch (error) {
            if (error?.code === 11000) {
                return res.status(409).json({
                    success: false,
                    message: "That username is already taken",
                });
            }

            throw error;
        }

        res.status(200).json({
            message: "Username saved",
            user: buildPublicUser(user),
        });
    } catch (error) {
        next(error);
    }
};

exports.forgotPassword = async (req, res, next) => {
    try {
        const email = normalizeEmail(req.body?.email);

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address",
            });
        }

        // This check is the same for every address, so it never reveals
        // whether an account exists.
        if (!isEmailConfigured()) {
            return res.status(503).json({
                success: false,
                message:
                    "Password reset emails are not configured yet. Add the SMTP settings to the server .env file.",
            });
        }

        const user = await User.findOne({ email });

        let resetEmail = null;

        // Blocked domains should not receive reset links. The response stays
        // generic so this cannot be used to confirm whether an account exists.
        if (user && !isDisallowedEmail(user.email)) {
            const rawToken = crypto.randomBytes(32).toString("hex");

            user.passwordResetToken = hashToken(rawToken);
            user.passwordResetExpires = new Date(
                Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000
            );

            await user.save();

            resetEmail = {
                to: user.email,
                name: user.name,
                resetUrl: `${getClientOrigin()}/reset-password/${rawToken}`,
            };
        }

        res.status(200).json({
            success: true,
            message:
                "If an account exists for that email, a reset link is on its way.",
        });

        if (resetEmail) {
            // Send after responding so the endpoint takes the same time for
            // known and unknown addresses (avoids account enumeration by
            // timing the SMTP round-trip).
            sendPasswordResetEmail(resetEmail).catch((error) => {
                console.error(
                    "Password reset email could not be sent:",
                    error.message
                );
            });
        }
    } catch (error) {
        next(error);
    }
};

exports.resetPassword = async (req, res, next) => {
    try {
        const token =
            typeof req.body?.token === "string"
                ? req.body.token.trim()
                : "";
        const newPassword =
            typeof req.body?.newPassword === "string"
                ? req.body.newPassword
                : "";

        if (!token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Reset link and new password are required",
            });
        }

        if (!/^[a-f0-9]{64}$/i.test(token)) {
            return res.status(400).json({
                success: false,
                message: "This reset link is invalid or has expired",
            });
        }

        const passwordProblem = getPasswordProblem(newPassword);

        if (passwordProblem) {
            return res.status(400).json({
                success: false,
                message: passwordProblem,
            });
        }

        const user = await User.findOne({
            passwordResetToken: hashToken(token),
            passwordResetExpires: { $gt: new Date() },
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "This reset link is invalid or has expired",
            });
        }

        if (user.password) {
            const isSamePassword = await bcrypt.compare(
                newPassword,
                user.password
            );

            if (isSamePassword) {
                return res.status(400).json({
                    success: false,
                    message:
                        "You cannot use your current password as the new password",
                });
            }
        }

        user.password = await bcrypt.hash(newPassword, PASSWORD_COST);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        // Opening a reset link proves control of the inbox, so it also
        // completes verification for accounts that never clicked the
        // original verification email.
        user.emailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        user.emailVerificationSentAt = undefined;
        // A password reset must sign out anyone who still has an old session.
        user.tokenVersion = (user.tokenVersion || 0) + 1;

        await user.save();
        disconnectUserSockets(req, user._id);

        res.status(200).json({
            success: true,
            message:
                "Password reset successfully. You can now sign in with your new password.",
        });
    } catch (error) {
        next(error);
    }
};

exports.verifyEmail = async (req, res, next) => {
    try {
        const token =
            typeof req.body?.token === "string"
                ? req.body.token.trim()
                : "";

        if (!/^[a-f0-9]{64}$/i.test(token)) {
            return res.status(400).json({
                success: false,
                message: "This verification link is invalid or has expired",
            });
        }

        const user = await User.findOne({
            emailVerificationToken: hashToken(token),
            emailVerificationExpires: { $gt: new Date() },
        }).select(
            "+emailVerificationToken +emailVerificationExpires +emailVerificationSentAt"
        );

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "This verification link is invalid or has expired",
            });
        }

        user.emailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        user.emailVerificationSentAt = undefined;

        await user.save();

        res.status(200).json({
            success: true,
            message: "Email verified. You can now sign in.",
        });
    } catch (error) {
        next(error);
    }
};

exports.resendVerification = async (req, res, next) => {
    try {
        const email = normalizeEmail(req.body?.email);

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address",
            });
        }

        if (isDisallowedEmail(email)) {
            return res.status(400).json({
                success: false,
                message: DISALLOWED_EMAIL_MESSAGE,
            });
        }

        if (!isEmailConfigured()) {
            return res.status(503).json({
                success: false,
                message:
                    "Verification emails are not configured yet. Add the SMTP settings to the server .env file.",
            });
        }

        const genericResponse = {
            success: true,
            message:
                "If that account still needs verification, a new link is on its way.",
        };

        // Existing accounts have no emailVerified field and are treated as
        // verified. Only explicitly unverified accounts need a new link.
        const user = await User.findOne({
            email,
            emailVerified: false,
        }).select(
            "+emailVerificationSentAt +emailVerificationToken +emailVerificationExpires"
        );

        if (!user) {
            return res.status(200).json(genericResponse);
        }

        const lastSent = user.emailVerificationSentAt
            ? new Date(user.emailVerificationSentAt).getTime()
            : 0;

        // Avoid flooding an inbox when someone clicks Resend repeatedly.
        if (Date.now() - lastSent < 60 * 1000) {
            return res.status(200).json(genericResponse);
        }

        const rawVerificationToken = createEmailVerificationToken(user);

        await user.save();

        res.status(200).json(genericResponse);

        sendEmailVerificationEmail({
            to: user.email,
            name: user.name,
            verifyUrl: buildVerificationUrl(rawVerificationToken, user.email),
            expiresMinutes: EMAIL_VERIFICATION_MINUTES,
        }).catch((error) => {
            console.error(
                "Verification email could not be sent:",
                error.message
            );
        });
    } catch (error) {
        next(error);
    }
};


exports.updateUserSettings = async (req, res, next) => {
    try {
        const booleanFields = [
            "enterToSend",
            "messageNotifications",
            "notificationSound",
            "readReceipts",
            "onlineStatus",
        ];
        const visibilityFields = [
            "profilePhotoVisibility",
            "lastSeenVisibility",
        ];
        const allowedVisibility = new Set([
            "everyone",
            "contacts",
            "nobody",
        ]);

        const updates = {};

        for (const field of booleanFields) {
            if (req.body[field] !== undefined) {
                if (typeof req.body[field] !== "boolean") {
                    return res.status(400).json({
                        success: false,
                        message: `${field} must be true or false`,
                    });
                }

                updates[field] = req.body[field];
            }
        }

        for (const field of visibilityFields) {
            if (req.body[field] !== undefined) {
                if (
                    typeof req.body[field] !== "string" ||
                    !allowedVisibility.has(req.body[field])
                ) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid ${field} value`,
                    });
                }

                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid settings provided"
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            {
                returnDocument: "after",
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
            user: buildPublicUser(updatedUser)
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
            user: buildPublicUser(updatedUser)
        });
    } catch (error) {
        next(error);
    }
};

exports.getAllUsers = async (req, res, next) => {
    try {
        const users = await User.find({
            _id: { $ne: req.user._id },
            needsUsername: { $ne: true },
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

        const trimmedReason = stripControlChars(reason);
        const trimmedDetails =
            typeof details === "string" ? stripControlChars(details) : "";

        if (!trimmedReason) {
            return res.status(400).json({
                success: false,
                message: "Please choose a reason for the report"
            });
        }

        if (trimmedReason.length > 80 || trimmedDetails.length > 1000) {
            return res.status(400).json({
                success: false,
                message: "That report is too long"
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
            reason: trimmedReason,
            details: trimmedDetails
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
