import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface PlaceResult {
  name: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  place_id?: string;
  website?: string;
  formatted_phone_number?: string;
  types?: string[];
}

router.post("/leads", async (req, res) => {
  const { niche, location } = req.body as { niche?: string; location?: string };

  if (!niche || !location) {
    res.status(400).json({ error: "Missing niche or location" });
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GOOGLE_PLACES_API_KEY not configured on server" });
    return;
  }

  try {
    const query = encodeURIComponent(`${niche} in ${location}`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      res.status(502).json({ error: `Places API HTTP error: ${resp.status}` });
      return;
    }

    const data = (await resp.json()) as { status: string; results: PlaceResult[]; error_message?: string };

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      res.status(502).json({
        error: `Places API status: ${data.status}${data.error_message ? " — " + data.error_message : ""}`,
      });
      return;
    }

    const leads = (data.results ?? []).slice(0, 20).map((place) => ({
      name: place.name,
      address: place.formatted_address ?? "",
      rating: place.rating ?? null,
      reviewCount: place.user_ratings_total ?? 0,
      placeId: place.place_id ?? "",
      url: place.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
        : `https://www.google.com/search?q=${encodeURIComponent(place.name + " " + location)}`,
      types: (place.types ?? []).slice(0, 3),
    }));

    res.json({ leads, total: leads.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("leads fetch failed:", msg);
    res.status(502).json({ error: msg });
  }
});

export default router;
