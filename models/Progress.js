import mongoose from "mongoose";

const ProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    movieId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Movie",
      required: true
    },

    // ✅ FOR SERIES
    season: { type: Number, default: null },
    episode: { type: Number, default: null },

    // ✅ WATCH DATA
    currentTime: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },

    completed: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("Progress", ProgressSchema);
