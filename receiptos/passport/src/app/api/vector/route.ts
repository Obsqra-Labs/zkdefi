import { NextResponse } from "next/server";
import { fetchVector } from "@/lib/vector";

/**
 * GET /api/vector?address=0x...
 *
 * Returns the six-signal reputation vector for the given wallet address
 * by calling the existing zkdefi backend API.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address || !/^0x[0-9a-fA-F]+$/.test(address)) {
    return NextResponse.json(
      { error: "Missing or invalid ?address= parameter" },
      { status: 400 }
    );
  }

  try {
    const vector = await fetchVector(address);
    return NextResponse.json(vector);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
