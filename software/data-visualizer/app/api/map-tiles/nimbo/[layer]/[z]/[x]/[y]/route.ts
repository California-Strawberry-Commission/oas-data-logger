import type { User } from "@/lib/auth";
import { withAuth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

function getNimboMonthYear(): { year: string; month: string } {
  const d = new Date();
  // Since monthly mosaics are available around the middle of the following month,
  // (and depends on the region, especially for HD) go back 2 months to be safe.
  d.setMonth(d.getMonth() - 2);
  return {
    year: d.getFullYear().toString(),
    month: (d.getMonth() + 1).toString(), // month is 0-indexed
  };
}

/**
 * GET /api/map-tiles/nimbo/[layer]/[z]/[x]/[y]
 *
 * Proxies a Nimbo satellite tile request server-side so the API token is never
 * exposed to the client. `layer` is the Nimbo compo number (e.g. 5 = RGB_HD).
 * The mosaic date (year/month) is computed server-side. Intended for use as the
 * `url` of a react-leaflet TileLayer with `tms={true}`.
 */
export const GET = withAuth(
  async (_request: NextRequest, _user: User, context) => {
    const { layer, z, x, y } = await context.params;

    // Validate route params
    if (
      !/^\d+$/.test(layer) ||
      !/^\d+$/.test(z) ||
      !/^\d+$/.test(x) ||
      !/^\d+$/.test(y)
    ) {
      return NextResponse.json(
        { error: "Invalid parameters" },
        { status: 400 },
      );
    }

    const token = process.env.NIMBO_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Nimbo not configured" },
        { status: 503 },
      );
    }

    const { year, month } = getNimboMonthYear();
    const url = `https://prod-data.nimbo.earth/mapcache/tms/1.0.0/${year}_${month}_${layer}@kermap/${z}/${x}/${y}.png?kermap_token=${token}`;

    let nimboResponse: Response;
    try {
      // Cache the response for 15 days to reduce Nimbo Geocredits usage
      nimboResponse = await fetch(url, {
        next: { revalidate: 60 * 60 * 24 * 15 },
      });
    } catch {
      return new NextResponse(null, { status: 502 });
    }

    if (!nimboResponse.ok) {
      return new NextResponse(null, { status: nimboResponse.status });
    }

    const body = await nimboResponse.arrayBuffer();
    return new NextResponse(body, {
      headers: {
        "Content-Type":
          nimboResponse.headers.get("Content-Type") ?? "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
);
