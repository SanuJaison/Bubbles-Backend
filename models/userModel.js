const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: function () {
        return !this.googleId;
      },
    },

    profilePicture: {
      type: String,
      default: "",
    },

    bio: {
      type: String,
      default: "",
      trim: true,
    },
    
    phone: {
      type: String,
      default: "",
      trim: true,
    },

    googleId: {
      type: String,
      default: "",
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