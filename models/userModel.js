const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 32,
      match: /^[a-z0-9._]+$/,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },

    password: {
      type: String,
      required: function () {
        return !this.googleId;
      },
      maxlength: 255,
    },

    profilePicture: {
      type: String,
      default: "",
      maxlength: 2048,
    },

    bio: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    
    phone: {
      type: String,
      default: "",
      trim: true,
      maxlength: 30,
    },

    googleId: {
      type: String,
      default: "",
      maxlength: 255,
      index: true,
    },

    // Accounts created before email verification existed are grandfathered in.
    // New password signups explicitly set this to false until they confirm
    // their inbox. Google sign-ins are verified by Google itself.
    emailVerified: {
      type: Boolean,
      default: true,
    },

    // Only the SHA-256 digest of the verification token is stored, so a
    // database leak cannot be used to verify someone else's address.
    emailVerificationToken: {
      type: String,
      default: undefined,
      select: false,
      maxlength: 64,
    },

    emailVerificationExpires: {
      type: Date,
      default: undefined,
      select: false,
    },

    emailVerificationSentAt: {
      type: Date,
      default: undefined,
      select: false,
    },

    // Google creates the account before the person has picked a username.
    // The app keeps them on the choose-username screen until this is false.
    needsUsername: {
      type: Boolean,
      default: false,
    },

    // Bumped whenever the password changes. Tokens carrying an older value
    // are rejected, which signs out every other session.
    tokenVersion: {
      type: Number,
      default: 0,
      select: true,
    },

    passwordResetToken: {
      type: String,
      default: undefined,
      select: false,
      maxlength: 64,
    },

    passwordResetExpires: {
      type: Date,
      default: undefined,
      select: false,
    },

    isOnline: {
      type: Boolean,
      default: false,
    },

    lastSeen: {
      type: Date,
      default: null,
    },

    profilePhotoVisibility: {
      type: String,
      enum: ["everyone", "contacts", "nobody"],
      default: "everyone",
    },

    lastSeenVisibility: {
      type: String,
      enum: ["everyone", "contacts", "nobody"],
      default: "everyone",
    },

    onlineStatus: {
      type: Boolean,
      default: true,
    },

    readReceipts: {
      type: Boolean,
      default: true,
    },

    enterToSend: {
      type: Boolean,
      default: true,
    },

    messageNotifications: {
      type: Boolean,
      default: true,
    },

    notificationSound: {
      type: Boolean,
      default: true,
    },

    chatWallpaper: {
      type: String,
      default: "",
      maxlength: 2048,
    },

    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Frozen copy of *this* user's profile, taken when they blocked someone —
    // the blocked person keeps seeing these details instead of live ones.
    blockedSnapshots: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        name: {
          type: String,
          default: "",
        },
        username: {
          type: String,
          default: "",
        },
        profilePicture: {
          type: String,
          default: "",
        },
        bio: {
          type: String,
          default: "",
        },
        // Presence is frozen too: going online/offline right after a block
        // would otherwise be a tell.
        lastSeen: {
          type: Date,
          default: null,
        },
        isOnline: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

module.exports = User;