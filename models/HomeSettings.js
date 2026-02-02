import mongoose from "mongoose";

const HomeSettingsSchema = new mongoose.Schema({
  featured: { type: Array, default: [] },
  newReleases: { type: Array, default: [] },
  trending: { type: Array, default: [] },
  movies: { type: Array, default: [] },
  series: { type: Array, default: [] },
  anime: { type: Array, default: [] },

  // ✅ NEW: TMDB IDs for welcome page slider (/)
  welcomeSliderTmdbIds: { type: [Number], default: [] },
});

export default mongoose.model("HomeSettings", HomeSettingsSchema);
