"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Globe, ChevronDown } from "lucide-react";
import { Message } from "@/lib/types";

export type SourceItem = {
  id: string;
  type: "web" | "doc" | "sheet" | "mail" | "other";
  title?: string;
  url?: string;
  label?: string; // domain or descriptor
  iconKey: "web" | "doc" | "sheet" | "gmail" | "other";
  favicon?: string;
};

// Sources are attached to the message by the stream layer; this component only renders them

function getIconForSource(source: SourceItem) {
  const size = 16;
  switch (source.iconKey) {
    case "gmail":
      return (
        <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1 bg-white">
          <Image
            src="/icons/gmail.png"
            alt="Gmail"
            width={17}
            height={24}
            className="object-cover"
          />
        </div>
      );
    case "doc":
      return (
        <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1 bg-white">
          <Image
            src="/icons/docs.png"
            alt="Doc"
            width={17}
            height={24}
            className="object-cover"
          />
        </div>
      );
    case "sheet":
      return (
        <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1 bg-white">
          <Image
            src="/icons/sheets.png"
            alt="Sheet"
            width={17}
            height={24}
            className="object-cover"
          />
        </div>
      );
    case "web":
      return source.favicon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source.favicon}
          alt=""
          className="w-4 h-4 rounded-sm object-contain bg-white"
        />
      ) : (
        <Globe size={16} className="text-gray-800" />
      );
    default:
      // Fallbacks: infer icon from type/label
      if (source.type === "mail" || source.label === "gmail.com") {
        return (
          <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1 bg-white">
            <Image
              src="/icons/gmail.png"
              alt="Gmail"
              width={17}
              height={24}
              className="object-cover"
            />
          </div>
        );
      }
      if (source.url && /docs\.google\.com\/.+\/document\//i.test(source.url)) {
        return (
          <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1 bg-white">
            <Image
              src="/icons/docs.png"
              alt="Doc"
              width={17}
              height={24}
              className="object-cover"
            />
          </div>
        );
      }
      if (
        source.url &&
        /docs\.google\.com\/.+\/spreadsheets\//i.test(source.url)
      ) {
        return (
          <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1 bg-white">
            <Image
              src="/icons/sheets.png"
              alt="Sheet"
              width={17}
              height={24}
              className="object-cover"
            />
          </div>
        );
      }
      return (
        <span
          className="inline-block w-4 h-4 rounded bg-gray-400"
          aria-hidden
        />
      );
  }
}

export function SourcesBar({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Only show at the end of the message (when not streaming)
  if (isStreaming) return null;
  const sources = message.sources || [];
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        className="flex items-center gap-1 text-[12px] text-gray-600 hover:text-gray-900 transition"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="sources-panel"
      >
        <span className="font-medium">Sources</span>
        <span className="ml-1 text-gray-400">({sources.length})</span>
        <ChevronDown
          size={14}
          className={`ml-1 transition-transform duration-200 ${isOpen ? "rotate-180" : "rotate-0"}`}
          aria-hidden
        />
      </button>

      <div
        id="sources-panel"
        className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? "max-h-[9999px] opacity-100 mt-2" : "max-h-0 opacity-0 mt-0"}`}
      >
        <div className="flex flex-wrap gap-2">
          {(showAll ? sources : sources.slice(0, 5)).map((src) => (
            <a
              key={src.id}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition"
            >
              <div className="flex-shrink-0">{getIconForSource(src)}</div>
              <div className="min-w-0">
                <div className="text-[12.5px] text-gray-900 truncate max-w-[200px]">
                  {src.title || src.label || src.url}
                </div>
                {src.label && (
                  <div className="text-[11px] text-gray-500 truncate max-w-[200px]">
                    {src.label}
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
        {sources.length > 5 && (
          <div className="mt-2">
            <button
              type="button"
              className="text-[12px] text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline transition"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show less" : `Show ${sources.length - 5} more`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
