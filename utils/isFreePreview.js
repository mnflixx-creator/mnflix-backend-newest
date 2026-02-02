export function isFreePreview(req) {
  // Support both query + body
  const season = Number(req.query?.season ?? req.body?.season ?? 0);
  const episode = Number(req.query?.episode ?? req.body?.episode ?? 0);

  // ✅ Free: Season 1 Episode 1 only
  return season === 1 && episode === 1;
}
