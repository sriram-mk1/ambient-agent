"use client";

import React from "react";
import { PanelRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { GraphNode, GraphLink } from "@/types/memory-graph";

export default function SidePanel({
  node,
  links,
  onCloseAction,
  onExpandAction,
  collapsed = false,
  setCollapsed,
}: {
  node: GraphNode | null;
  links: GraphLink[];
  onCloseAction: () => void;
  onExpandAction: (nodeId: string) => void;
  collapsed?: boolean;
  setCollapsed?: (v: boolean) => void;
}) {
  const connected = React.useMemo(() => {
    if (!node) return [] as GraphLink[];
    return (links || []).filter((l) => {
      const s = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const t = typeof l.target === 'object' ? (l.target as any).id : l.target;
      return s === node.id || t === node.id;
    });
  }, [node?.id, links]);
  const displayType = React.useMemo(() => {
    if (!node) return "";
    const raw = String(node.type ?? "");
    const base = raw.split("|")[0]?.trim() ?? raw;
    return base;
  }, [node?.type]);

  return (
    <>
      {collapsed && (
        <button
          className="absolute right-3 top-3 z-10 h-10 w-10 rounded-md border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 transition shadow-none flex items-center justify-center"
          onClick={() => setCollapsed?.(false)}
          aria-label="Open details"
        >
          <PanelRight className="w-5 h-5" strokeWidth={1.25} />
        </button>
      )}

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-3 top-3 bottom-3 w-[22rem] rounded-md border border-gray-300/40 bg-white/10 backdrop-blur-xl supports-[backdrop-filter]:bg-white/10 p-4 overflow-y-auto no-scrollbar z-10"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-gray-500">{displayType}</div>
                <div className="text-lg font-medium text-gray-900 break-words">{node ? node.label : "Memory details"}</div>
              </div>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => {
                  try { onCloseAction(); } catch {}
                  setCollapsed?.(true);
                }}
                aria-label="Close details"
              >
                ✕
              </button>
            </div>

            {!node && (
              <p className="mt-3 text-xs text-gray-500">Click a node in the graph to see its details, connections, and metadata.</p>
            )}

            {node && (
              <>
                {node.summary && (
                  <div className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{node.summary}</div>
                )}
                {node.createdAt && (
                  <div className="mt-2 text-xs text-gray-500">Created: {new Date(node.createdAt).toLocaleString()}</div>
                )}
                <div className="mt-4">
                  <div className="text-sm font-medium text-gray-800">Connections ({connected.length})</div>
                  <ul className="mt-2 space-y-2">
                    {connected.map((l, idx) => {
                      const s = typeof l.source === 'object' ? (l.source as any).id : l.source;
                      const t = typeof l.target === 'object' ? (l.target as any).id : l.target;
                      const other = s === node.id ? t : s;
                      return (
                        <li key={idx} className="text-xs text-gray-600">
                          <span className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded px-1 py-0.5 mr-2">{String(l.type)}</span>
                          <span>{String(other)}</span>
                          {typeof l.score === 'number' && (
                            <span className="ml-2 text-[11px] text-gray-500">score {l.score.toFixed(2)}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="mt-4 flex gap-2">
                  {typeof (node as any).metadata?.sourceUrl === 'string' && (
                    <a
                      className="text-xs rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                      href={String((node as any).metadata.sourceUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source
                    </a>
                  )}
                </div>
                {node.metadata && (
                  <div className="mt-4">
                    <div className="text-sm font-medium text-gray-800">Metadata</div>
                    <pre className="mt-2 text-[11px] bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto">
                      {JSON.stringify(node.metadata, null, 2)}
                    </pre>
                  </div>
                )}
                <div className="mt-5 flex items-center gap-2">
                  <button
                    className="text-xs rounded border border-gray-300 px-2 py-1 bg-white hover:bg-gray-50"
                    onClick={() => alert('Save not implemented')}
                  >
                    Save
                  </button>
                  <button
                    className="text-xs rounded border border-red-300 text-red-600 px-2 py-1 bg-white hover:bg-red-50"
                    onClick={() => alert('Delete not implemented')}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    <style jsx global>{`
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      .no-scrollbar::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      .no-scrollbar::-webkit-scrollbar-thumb { background: transparent !important; }
      .no-scrollbar::-webkit-scrollbar-track { background: transparent !important; }
    `}</style>
    </>
  );
}
