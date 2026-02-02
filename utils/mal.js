// utils/mal.js
import axios from "axios";

/**
 * Fetch anime metadata from MyAnimeList via Jikan by title
 * and normalize it to your Movie schema shape.
 */
export async function fetchMalAnimeByTitle(title) {
  if (!title) return null;

  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(
    title
  )}&limit=1&sfw=false`;

  const res = await axios.get(url, { timeout: 8000 });
  const item = res.data?.data?.[0];

  if (!item) return null;

  const genres =
    Array.isArray(item.genres) && item.genres.length
      ? item.genres.map((g) => g.name)
      : [];

  const year =
    item.aired?.prop?.from?.year != null
      ? String(item.aired.prop.from.year)
      : null;

  const poster =
    item.images?.jpg?.image_url ||
    item.images?.webp?.image_url ||
    null;

  // trailer image is a nice banner-ish image if present
  const banner =
    item.trailer?.images?.maximum_image_url ||
    item.trailer?.images?.large_image_url ||
    null;

  return {
    malId: item.mal_id,
    title:
      item.title_english ||
      item.title ||
      item.title_japanese ||
      "",
    originalTitle: item.title_japanese || null,
    description: item.synopsis || "",
    year,
    rating: item.score || 0,
    episodes: item.episodes || 0,
    status: item.status || "",
    genres,
    poster,
    banner,
  };
}
