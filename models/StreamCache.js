// backend/models/StreamCache.js
import mongoose from "mongoose";

const streamCacheSchema = new mongoose.Schema({
  tmdbId: { type: Number, index: true },
  type: {
    type: String,
    enum: ["movie", "series", "anime"],
    required: true,
    index: true,
  },
  season: { type: Number, default: null, index: true },
  episode: { type: Number, default: null, index: true },

  // ✅ NEW: cache versioning (bump when resolver logic changes)
  resolverVersion: { type: Number, default: 1, index: true },

  // what we got from Zentlify: array of streams
  streams: {
    type: Array,
    default: [],
  },

  // when we cached this
  cachedAt: {
    type: Date,
    default: Date.now,
  },
});

// ✅ UPDATED: quick lookup includes resolverVersion
streamCacheSchema.index({
  tmdbId: 1,
  type: 1,
  season: 1,
  episode: 1,
  resolverVersion: 1,
});

export default mongoose.model("StreamCache", streamCacheSchema);
