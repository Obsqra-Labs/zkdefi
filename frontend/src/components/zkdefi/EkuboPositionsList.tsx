"use client";

import { useEffect, useState } from "react";
import { getEkuboPositions, type EkuboPosition } from "@/lib/api/ekubo";

export interface EkuboPositionsListProps {
  ownerAddress: string | undefined;
}

export function EkuboPositionsList({ ownerAddress }: EkuboPositionsListProps) {
  const [positions, setPositions] = useState<EkuboPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerAddress) {
      setLoading(false);
      setPositions([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEkuboPositions(ownerAddress)
      .then((res) => {
        if (!cancelled) {
          setPositions(res.positions ?? []);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load positions");
          setPositions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerAddress]);

  if (!ownerAddress) {
    return (
      <p className="text-sm text-zinc-500">Connect a wallet to see Ekubo LP positions.</p>
    );
  }
  if (loading) {
    return <p className="text-sm text-zinc-400">Loading Ekubo positions…</p>;
  }
  if (error) {
    return <p className="text-sm text-amber-500">{error}</p>;
  }
  if (positions.length === 0) {
    return <p className="text-sm text-zinc-500">No Ekubo LP positions.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {positions.map((pos) => (
        <li
          key={pos.position_id}
          className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 flex items-center justify-between gap-2"
        >
          <span className="font-mono text-zinc-300 truncate" title={pos.position_id}>
            {pos.position_id}
          </span>
          {pos.pool_key != null && (
            <span className="text-zinc-500 font-mono text-xs truncate max-w-[12rem]" title={String(pos.pool_key)}>
              {String(pos.pool_key)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
