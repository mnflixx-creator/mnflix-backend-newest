// models/Report.js
import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    movie: { type: mongoose.Schema.Types.ObjectId, ref: "Movie", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    problemType: { type: String },
    message: { type: String },

    status: {
      type: String,
      enum: ["new", "seen", "fixed", "unfixable"],
      default: "new",
    },

    // 🔹 NEW: admin reply
    adminReply: { type: String, default: "" },
    repliedAt: { type: Date },
    userSeenReply: { type: Boolean, default: false }, // for notification badge
  },
  { timestamps: true }
);

export default mongoose.model("Report", reportSchema);
