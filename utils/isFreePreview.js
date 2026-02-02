export function isFreePreview(req, movie = null) {
  // ✅ default to 1 when missing (instead of 0)
  const season = Number(req.query?.season ?? req.body?.season ?? 1);
  const episode = Number(req.query?.episode ?? req.body?.episode ?? 1);

  if (!movie) {
    return season === 1 && episode === 1;
  }

  const type = String(movie?.type || "").toLowerCase();

  // ✅ Treat kdrama/cdrama/anime as series-like too
  const isSeries =
    type === "series" ||
    type === "tv" ||
    type === "anime" ||
    type === "kdrama" ||
    type === "cdrama";

  if (!isSeries) return false;

  const seasonsCount = Array.isArray(movie?.seasons) ? movie.seasons.length : 0;
  if (seasonsCount <= 0) return false;

  if (seasonsCount === 1) {
    return season === 1 && episode === 1;
  }

  return season === 1;
}
