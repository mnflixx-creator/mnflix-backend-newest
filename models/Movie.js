
import mongoose from "mongoose";

const movieSchema = new mongoose.Schema(
  {
    // ✅ TMDB linking (so we can find Mongo doc by TMDB id)
    tmdbId: { type: Number, index: true },

    // 🆕 MAL id (MyAnimeList)
    malId: { type: Number, index: true },

    // ⭐ NEW: where did this entry come from?
    // "tmdb" = imported
    // "manual" = admin created (anime, cdrama, missing kdrama, etc)
    // 🆕 "mal" = imported from MyAnimeList
    source: {
      type: String,
      enum: ["tmdb", "manual", "mal"], // 🆕 added "mal"
      default: "tmdb",
      index: true,
    },

    // ✅ If admin edits title/description etc, mark as edited
    isEdited: { type: Boolean, default: false },

    // 🆕 original (JP) title if we have it from MAL
    originalTitle: { type: String },

    title: { type: String, required: true },
    description: { type: String },
    year: { type: String },

    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },

    // 🔞 Adult-only flag (manually chosen from admin)
    isAdult: {
      type: Boolean,
      default: false,
      index: true,
    },

    // ⭐ Sorting for adult page (bigger = more popular)
    // TMDB has "popularity" — we store it here
    popularity: {
      type: Number,
      default: 0,
      index: true,
    },

    genres: {
      type: [String],
      default: [],
    },

    // Images
    thumbnail: { type: String },
    banner: { type: String },

    // 🆕 total episodes for anime / series from MAL (optional)
    episodes: { type: Number, default: 0 },

    // 🆕 status like "Finished Airing", "Currently Airing"
    status: { type: String },

    // Video Players (for normal movies)
    player1: { type: String },
    player2: { type: String },
    player3: { type: String },
    // ✅ Uploaded HLS playlist path (Cloudflare R2)
    // Example: "/hls/<movieId>/master.m3u8"  (or full https url if you want)
    hlsPath: { type: String, default: "" },

    // ⭐ NEW: SUBTITLES FOR MOVIES
    subtitles: [
      {
        lang: { type: String, required: true },   // "en", "mn"
        label: { type: String, required: true },  // "English", "Монгол"
        url: { type: String, required: true },    // .vtt/.srt url
        isDefault: { type: Boolean, default: false },

        // ✅ NEW (backward compatible)
        scope: {
          type: String,
          enum: ["global", "provider"],
          default: "global",
        },

        // ✅ NEW (only used if scope === "provider")
        provider: {
          type: String,
          default: "",
          lowercase: true, // so "Zen" becomes "zen"
        },
      },
    ],

    // ⭐ NEW: does this movie need subscription?
    requiresSubscription: {
      type: Boolean,
      default: false, // free by default
    },

    kidsOnly: {
      type: Boolean,
      default: false,
    },

    isTrending: {
      type: Boolean,
      default: false,
    },

    /// ✅ movie | series | anime | kdrama | chinese drama
    type: {
      type: String,
      enum: ["movie", "series", "anime", "kdrama", "cdrama"],
      required: true,
      immutable: true, // ✅ prevents changing movie<->series later
    },

    // ✅ ✅ ✅ SERIES SYSTEM (ADDED SAFELY)
    seasons: [
      {
        seasonNumber: { type: Number, required: true }, // 1,2,3...
        tmdbSeasonId: { type: Number },                 // TMDB season id
        episodes: [
          {
            episodeNumber: { type: Number, required: true }, // 1,2,3...
            tmdbEpisodeId: { type: Number },                 // TMDB episode id
            name: { type: String },                          // Episode title
            airDate: { type: String },                       // "2024-02-01"
            player: { type: String, default: "" },
            hlsPath: { type: String, default: "" },

            subtitles: [
              {
                lang: { type: String, required: true },
                label: { type: String, required: true },
                url: { type: String, required: true },
                isDefault: { type: Boolean, default: false },

                // ✅ add these too
                scope: { type: String, enum: ["global", "provider"], default: "global" },
                provider: { type: String, default: "", lowercase: true },
              },
            ],

            // ⭐ IMPORTANT: for manual episodes you'll also fill in player1/2/3 here if you want
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

// 🔹 Speed up title searches (used in /api/movies/search/:q)
movieSchema.index({ title: 1 });

// ✅ Prevent collisions between movie and series with same tmdbId
movieSchema.index(
  { tmdbId: 1, type: 1 },
  { unique: true, sparse: true } // sparse because manual/anime may not have tmdbId
);

// 🔹 Speed up: GET /type/:type + homepage filters
movieSchema.index({ type: 1, createdAt: -1 });

// 🔹 Speed up: trending lists sorted by updatedAt
movieSchema.index({ isTrending: 1, updatedAt: -1 });

// 🔹 Optional: quickly fetch manual anime / cdrama
movieSchema.index({ source: 1, type: 1, createdAt: -1 });

movieSchema.index({ isAdult: 1, popularity: -1 });

export default mongoose.model("Movie", movieSchema);