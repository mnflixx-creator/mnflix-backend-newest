import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true, // ✅ auto converts to lower
      trim: true,      // ✅ removes spaces
      index: true,
    },

    password: {
      type: String,
      required: true,
    },

    // ❗ Password reset OTP (existing)
    otpCode: {
      type: String,
    },
    otpExpires: {
      type: Date,
    },

    // ⭐ ADD THESE TWO NEW FIELDS FOR EMAIL OTP RESET
    resetOTP: Number,
    resetOTPExpire: Date,

    // ✅ BANK TRANSFER SUBSCRIPTION (Golomt email)
    bankPayCode: { type: String, default: null },
    bankPayCodeCreatedAt: { type: Date, default: null },

    // ✅ SUBSCRIPTION SYSTEM (UPGRADED)
    subscriptionActive: {
      type: Boolean,
      default: false,
    },

    subscriptionPlan: {
      type: String,
      enum: ["none", "basic", "premium"],
      default: "none",
    },

    subscriptionStatus: {
      type: String,
      enum: ["inactive", "active", "expired"],
      default: "inactive",
    },

    subscriptionExpiresAt: {
      type: Date,
      default: null,
    },

    autoRenew: {
      type: Boolean,
      default: false,
    },

    subscriptionHistory: [
      {
        plan: String,
        paidBy: String, // "card" | "qpay" | "golomt-email"
        amount: Number,
        startAt: Date,
        endAt: Date,
        status: String, // "success" | "canceled" | "expired"

        // ✅ ADD THESE (so old code is saved forever)
        transferCode: { type: String, default: null },
        note: { type: String, default: null },
      },
    ],

    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Movie" }],

    watchHistory: [
      {
        movie: { type: mongoose.Schema.Types.ObjectId, ref: "Movie" },
        progress: { type: Number, default: 0 },
        duration: { type: Number, default: 0 },
      },
    ],

    profiles: [
      {
        name: { type: String, required: true },
        avatar: { type: String, required: true },
        kids: { type: Boolean, default: false },
      },
    ],
    currentProfile: {
      name: String,
      avatar: String,
    },

    // ✅ DEVICE MANAGER SYSTEM
    devices: [
      {
        deviceId: String,
        deviceName: String,
        lastIP: String,
        lastActive: Date,
        isStreaming: { type: Boolean, default: false }
      }
    ],
    activeStreamDeviceId: {
      type: String,
      default: null
    },

    currentStreamingDevice: {
      deviceId: String,
      startedAt: Date
    }

  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
