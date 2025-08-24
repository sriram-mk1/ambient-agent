"use client";

import React, { useState } from "react";

export default function Controls({
  onSearch,
  onScore,
}: {
  onSearch: (q: string) => void;
  onScore: (min: number) => void;
}) {
  const [q, setQ] = useState("");
  const [score, setScore] = useState(0);
  return (
    <div className="absolute left-4 top-4 z-10 bg-white/90 backdrop-blur rounded border border-gray-200 shadow-sm p-2 flex items-center gap-2">
      <input
        className="w-56 text-sm rounded border border-gray-200 px-2 py-1 outline-none"
        placeholder="Search memories..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSearch(q);
        }}
      />
      <label className="text-xs text-gray-600">min score</label>
      <input
        type="number"
        step="0.05"
        min={0}
        max={1}
        className="w-20 text-sm rounded border border-gray-200 px-2 py-1 outline-none"
        value={score}
        onChange={(e) => {
          const v = Math.max(0, Math.min(1, Number(e.target.value)));
          setScore(v);
          onScore(v);
        }}
      />
      <button className="text-xs rounded border border-gray-300 px-2 py-1 hover:bg-gray-50" onClick={() => onSearch(q)}>
        Apply
      </button>
    </div>
  );
}
