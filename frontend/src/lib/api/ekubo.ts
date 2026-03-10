import { apiUrl } from "./client";

export interface EkuboPosition {
  position_id: string;
  pool_key?: string;
  [key: string]: unknown;
}

export interface EkuboPositionsResponse {
  positions: EkuboPosition[];
  count: number;
  owner?: string;
}

export async function getEkuboPositions(owner: string): Promise<EkuboPositionsResponse> {
  const url = `${apiUrl("/api/v1/zkdefi/ekubo/positions")}?owner=${encodeURIComponent(owner)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Ekubo positions failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (!text?.trim()) {
    return { positions: [], count: 0, owner };
  }
  try {
    const data = JSON.parse(text) as EkuboPositionsResponse;
    return {
      positions: Array.isArray(data?.positions) ? data.positions : [],
      count: typeof data?.count === "number" ? data.count : 0,
      owner: data?.owner ?? owner,
    };
  } catch {
    return { positions: [], count: 0, owner };
  }
}
