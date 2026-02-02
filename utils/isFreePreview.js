export function isFreePreview(req, movie = null) {
  // Support both query + body
  const season = Number(req.query?.season ?? req.body?.season ?? 0);
  const episode = Number(req.query?.episode ?? req.body?.episode ?? 0);

  // ✅ If we don't have movie info, keep old behavior (safe)
  // Free: Season 1 Episode 1 only
  if (!movie) {
    return season === 1 && episode === 1;
  }

  const type = String(movie?.type || "").toLowerCase();
  const isSeries = type === "series" || type === "tv";

  // movies never free preview
  if (!isSeries) return false;

  const seasonsCount = Array.isArray(movie?.seasons) ? movie.seasons.length : 0;
  if (seasonsCount <= 0) return false;

  // ✅ If only 1 season -> only S1E1 free
  if (seasonsCount === 1) {
    return season === 1 && episode === 1;
  }

  // ✅ If 2+ seasons -> all Season 1 is free
  return season === 1;
}
