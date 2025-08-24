"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  CornerDownLeft,
  SquarePen,
  MessageCircle,
  ChevronDown,
  Sparkle,
  Plus,
  Zap,
  User,
  UserCheck,
  UserCog,
  Loader2,
  Settings,
  Brain,
  Waypoints,
  Keyboard,
  Calendar,
  Sheet,
  Github,
  MessageSquare,
  Globe,
  BookOpen,
  LayoutGrid,
} from "lucide-react";
import Image from "next/image";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAIChat } from "@/hooks/useAIChat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { SourcesBar } from "@/components/SourcesBar";
import { ToolCall, MessageContent } from "@/lib/types";
import { useParallelExecutionConfig } from "@/hooks/useAgentConfig";
import { Mail, FileText, Table } from "lucide-react";

interface ChatPageProps {

}

// Utilities for tool UI formatting (UI-only)
function formatToolName(rawName: string): string {
  if (!rawName) return "tool";
  return rawName
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

function buildDynamicActionPhrase(
  toolName: string,
  args: any | undefined,
): string | null {
  const n = (toolName || "").toLowerCase();
  const arg = args || {};
  const query: string = String(arg.query || "").toLowerCase();

  // Gmail listEmails
  if (n.includes("listemails")) {
    if (query.includes("is:unread")) return "listing your unread emails";
    const labelMatch = query.match(/label:([^\s]+)/);
    if (labelMatch) return `listing emails in your ${labelMatch[1]} label`;
    const fromMatch = query.match(/from:([^\s]+)/);
    if (fromMatch) return `listing your emails from ${fromMatch[1]}`;
    const subjectMatch = query.match(/subject:\"([^\"]+)\"|subject:([^\s]+)/);
    if (subjectMatch)
      return `searching your emails with subject "${subjectMatch[1] || subjectMatch[2]}"`;
    if (query) return `searching your emails (${query})`;
    return "listing your emails";
  }

  // Gmail markEmailAsRead/Unread
  if (n.includes("markemailasread")) return "marking your email as read";
  if (n.includes("markemailasunread")) return "marking your email as unread";
  if (n.includes("getemail")) return "getting your email details";
  if (n.includes("sendemail")) {
    const to = arg.to || arg.recipient;
    if (to) return `sending an email to ${to}`;
    const subject = arg.subject;
    if (subject) return `sending an email (subject: "${subject}")`;
    return "sending an email";
  }
  if (n.includes("getinboxstats")) return "retrieving inbox stats";
  if (n.includes("movemailtolabel"))
    return `moving email to label ${arg.label || arg.labelId || ""}`.trim();
  if (n.includes("deleteemail")) return "deleting email";
  if (n.includes("listlabels")) return "listing your labels";

  // Docs
  if (n.includes("listdocuments")) return "listing your documents";
  if (n.includes("getdocument")) return "getting your document";
  if (n.includes("createdocument")) return "creating a document";
  if (n.includes("inserttext")) return "inserting text into your document";
  if (n.includes("updatedocument")) return "updating your document";
  if (n.includes("deletedocument")) return "deleting your document";

  // Sheets
  if (n.includes("listspreadsheets")) return "listing your spreadsheets";
  if (n.includes("getspreadsheet")) return "getting your spreadsheet";
  if (n.includes("createspreadsheet")) return "creating a spreadsheet";
  if (n.includes("getvalues"))
    return `retrieving values${arg.range ? ` from ${arg.range}` : ""}`;
  if (n.includes("updatevalues"))
    return `updating values${arg.range ? ` in ${arg.range}` : ""}`;
  if (n.includes("appendvalues"))
    return `appending values${arg.range ? ` to ${arg.range}` : ""}`;
  if (n.includes("deletespreadsheet")) return "deleting your spreadsheet";

  // Calendar
  if (n.includes("listevents")) {
    if (arg.timeMin && arg.timeMax)
      return `listing calendar events between ${arg.timeMin} and ${arg.timeMax}`;
    if (arg.timeMin) return `listing calendar events after ${arg.timeMin}`;
    if (arg.timeMax) return `listing calendar events before ${arg.timeMax}`;
    return "listing calendar events";
  }
  if (n.includes("getevent")) return "getting calendar event details";
  if (n.includes("createevent"))
    return `creating a calendar event${arg.summary ? ` titled "${arg.summary}"` : ""}`;
  if (n.includes("updateevent")) return "updating a calendar event";
  if (n.includes("deleteevent")) return "deleting a calendar event";

  // Memory/Zep
  if (n.includes("search_user_facts")) return "searching your user facts";
  if (n.includes("search_memory_graph")) return "searching your memory graph";
  if (n.includes("add_contextual_data"))
    return "adding contextual data to your memory";

  // Social discussion search (Exa) — minimal phrasing
  if (n.includes("social_discussion_search_exa") || n.includes("social_discussion")) {
    const topic = arg.topic || arg.query || arg.q;
    return topic ? `searching socials for "${String(topic)}"` : "searching socials";
  }

  // LinkedIn search (Exa) — minimal phrasing
  if (n.includes("linkedin_search_exa") || n.includes("linkedin")) {
    const q = arg.query || arg.q || arg.keyword || arg.keywords;
    return q ? `linkedin: "${String(q)}"` : "linkedin search";
  }

  // Company research (Exa) — minimal phrasing
  if (n.includes("company_research_exa") || n.includes("company_research")) {
    const company = arg.companyName || arg.company || arg.name;
    return company ? `researching "${String(company)}"` : "company research";
  }

  // Crawling content (Exa) — minimal phrasing
  if (n.includes("crawling_exa") || n.includes("crawl") || n.includes("crawling")) {
    const url = arg.url;
    return url ? `crawling ${String(url)}` : "crawling page";
  }

  // Web search (Exa) specific — minimal phrasing
  if (n.includes("web_search_exa")) {
    const q = arg.query || arg.q || arg.keyword || arg.keywords;
    return q ? `web search: "${String(q)}"` : "web search";
  }

  // Fast web search (Exa) — minimal phrasing
  if (n.includes("fast_web_search")) {
    const q = arg.query || arg.q || arg.keyword || arg.keywords;
    return q ? `web search: "${String(q)}"` : "web search";
  }

  // Generic Exa/web search fallback
  if (n.includes("web_search") || n.includes("exa")) {
    const q = arg.query || arg.q || arg.keyword || arg.keywords;
    if (q) return `searching the web for "${String(q)}"`;
    return "searching the web";
  }

  // Human input (no running line for approval state)
  if (n.includes("human_input")) return null;

  return null;
}

// Truncate helper utilities for tool call phrasing
function truncateText(input: string, max: number): string {
  if (!input) return "";
  return input.length > max ? `${input.slice(0, Math.max(0, max - 1))}…` : input;
}

function truncatePhraseAndDetails(
  phrase: string,
  details: string | null,
  maxTotal: number,
): { phraseOut: string; detailsOut: string | null; showDash: boolean } {
  const DASH = " — ";
  // If phrase alone exceeds the limit, truncate phrase and drop details
  if (phrase.length >= maxTotal) {
    return { phraseOut: truncateText(phrase, maxTotal), detailsOut: null, showDash: false };
  }

  if (!details) {
    return { phraseOut: phrase, detailsOut: null, showDash: false };
  }

  // Reserve space for dash if any details are shown
  const remainingForDetails = maxTotal - phrase.length - DASH.length;
  if (remainingForDetails <= 0) {
    return { phraseOut: phrase, detailsOut: null, showDash: false };
  }

  const detailsOut = truncateText(details, remainingForDetails);
  return { phraseOut: phrase, detailsOut, showDash: true };
}

function buildExtraDetails(
  toolName: string,
  args: any | undefined,
): string | null {
  const n = (toolName || "").toLowerCase();
  const a: any = args || {};
  const parts: string[] = [];

  // Common helpers
  const push = (label: string, value?: any) => {
    if (value == null || value === "") return;
    const toText = (v: any): string => {
      try {
        if (Array.isArray(v)) {
          const shown = v.slice(0, 3).map((x) => toText(x));
          const extra = v.length > 3 ? ` +${v.length - 3} more` : "";
          return `${shown.join(", ")}${extra}`;
        }
        if (typeof v === "object") {
          // Prefer compact preview of objects
          const keys = Object.keys(v).slice(0, 3);
          const preview = keys
            .map((k) => `${k}=${toText((v as any)[k])}`)
            .join(", ");
          const extra = Object.keys(v).length > 3 ? " …" : "";
          return `{ ${preview}${extra} }`;
        }
        const s = String(v);
        return s.length > 120 ? `${s.slice(0, 117)}…` : s;
      } catch {
        const s = String(v);
        return s.length > 120 ? `${s.slice(0, 117)}…` : s;
      }
    };
    parts.push(`${label}: ${toText(value)}`);
  };

  if (n.includes("listemails")) {
    if (a.query) push("query", a.query);
    if (a.limit) push("limit", a.limit);
    if (a.page) push("page", a.page);
  }
  if (n.includes("sendemail")) {
    push("to", a.to || a.recipient);
    push("subject", a.subject);
    if (a.cc) push("cc", Array.isArray(a.cc) ? a.cc.join(", ") : a.cc);
    if (a.bcc) push("bcc", Array.isArray(a.bcc) ? a.bcc.join(", ") : a.bcc);
  }
  if (n.includes("getemail")) push("id", a.id || a.messageId);
  if (
    n.includes("markemailasread") ||
    n.includes("markemailasunread") ||
    n.includes("deleteemail")
  )
    push("id", a.id || a.messageId);
  if (n.includes("movemailtolabel")) push("label", a.label || a.labelId);

  if (n.includes("listdocuments")) push("query", a.query);
  if (n.includes("getdocument")) push("documentId", a.documentId || a.id);
  if (n.includes("inserttext")) {
    push("documentId", a.documentId);
    push("location", a.location || a.index);
    if (a.text) push("textLength", String(a.text).length);
  }
  if (n.includes("createdocument")) push("title", a.title || a.name);

  if (n.includes("listspreadsheets")) push("query", a.query);
  if (
    n.includes("getvalues") ||
    n.includes("updatevalues") ||
    n.includes("appendvalues")
  ) {
    push("spreadsheetId", a.spreadsheetId);
    push("range", a.range);
  }
  if (n.includes("createspreadsheet")) push("title", a.title || a.name);

  if (n.includes("listevents")) {
    push("timeMin", a.timeMin);
    push("timeMax", a.timeMax);
    push("calendarId", a.calendarId);
  }
  if (
    n.includes("getevent") ||
    n.includes("updateevent") ||
    n.includes("deleteevent")
  )
    push("eventId", a.eventId || a.id);
  if (n.includes("createevent") || n.includes("updateevent")) {
    push("summary", a.summary || a.title);
    push("start", a.start?.dateTime || a.start?.date || a.start);
    push("end", a.end?.dateTime || a.end?.date || a.end);
  }

  if (n.includes("search_user_facts") || n.includes("search_memory_graph")) {
    push("query", a.query);
    if (a.limit) push("limit", a.limit);
    if (a.scope) push("scope", a.scope);
  }

  // Social discussion search (Exa) — minimal details: topic + a couple of platforms
  if (n.includes("social_discussion_search_exa") || n.includes("social_discussion")) {
    push("topic", a.topic || a.query || a.q);
    if (Array.isArray(a.platforms) && a.platforms.length) {
      const shown = a.platforms.slice(0, 2);
      const extra = a.platforms.length > 2 ? ` +${a.platforms.length - 2} more` : "";
      push("platforms", `${shown.join(", ")}${extra}`);
    }
  }

  // LinkedIn search (Exa) — minimal details: query only
  if (n.includes("linkedin_search_exa") || (n.includes("linkedin") && !n.includes("company"))) {
    push("query", a.query || a.q || a.keyword || a.keywords);
  }

  // Company research (Exa) — minimal details: company + a couple of sites
  if (n.includes("company_research_exa") || n.includes("company_research")) {
    push("company", a.companyName || a.company || a.name);
    if (Array.isArray(a.includeDomains) && a.includeDomains.length) {
      const shown = a.includeDomains.slice(0, 2);
      const extra = a.includeDomains.length > 2 ? " …" : "";
      push("sites", shown.join(", ") + extra);
    }
  }

  // Crawling (Exa) — minimal details: url only
  if (n.includes("crawling_exa") || n.includes("crawl") || n.includes("crawling")) {
    push("url", a.url);
  }

  // Web search (Exa) — minimal details: query only
  if (n.includes("web_search_exa")) {
    push("query", a.query || a.q || a.keyword || a.keywords);
  }

  // Fast web search and generic web_search — minimal details: query only
  if (n.includes("fast_web_search") || n.includes("web_search")) {
    push("query", a.query || a.q || a.keyword || a.keywords);
  }

  // Generic summarizer for any other tools
  if (parts.length === 0) {
    const SENSITIVE_KEYS = new Set([
      "apiKey",
      "apikey",
      "token",
      "accessToken",
      "authorization",
      "password",
      "secret",
    ]);
    const PREFERRED_KEYS = [
      // search-like
      "query",
      "q",
      "keywords",
      // identities
      "id",
      "messageId",
      "documentId",
      "eventId",
      "calendarId",
      "spreadsheetId",
      "sheetId",
      // files/paths
      "path",
      "filePath",
      "filename",
      "file",
      "url",
      // git/github
      "owner",
      "repo",
      "branch",
      "pr",
      "prId",
      "issue",
      "issueId",
      // email
      "to",
      "from",
      "subject",
      // titles/names
      "title",
      "name",
      // ranges/time
      "range",
      "timeMin",
      "timeMax",
      "start",
      "end",
      "date",
      // pagination/counts
      "numResults",
      "limit",
      "page",
      "count",
    ];

    const seen = new Set<string>();
    const tryPush = (key: string) => {
      if (seen.has(key)) return;
      if (SENSITIVE_KEYS.has(key)) return;
      if (!(key in a)) return;
      const val = a[key];
      if (val == null || val === "") return;
      seen.add(key);
      push(key, val);
    };

    // Push preferred keys in order
    PREFERRED_KEYS.forEach(tryPush);

    // If still nothing, add up to first 3 non-sensitive scalar-ish keys
    if (parts.length === 0) {
      const extraKeys = Object.keys(a).filter(
        (k) => !SENSITIVE_KEYS.has(k) && a[k] != null && a[k] !== "",
      );
      for (const k of extraKeys.slice(0, 3)) {
        tryPush(k);
      }
    }
  }

  return parts.length ? parts.join(", ") : null;
}

function getToolIcon(name: string, options?: { isParallelGroup?: boolean }) {
  const lower = (name || "").toLowerCase();

  if (options?.isParallelGroup)
    return <Waypoints size={16} className="text-gray-600" />;
  if (lower.includes("human_input") || lower.includes("human input"))
    return <Keyboard size={16} className="text-gray-600" />;
  if (
    lower.includes("zep") ||
    lower.includes("memory") ||
    lower.includes("add_contextual_data") ||
    lower.includes("search_user_facts") ||
    lower.includes("search memory graph") ||
    lower.includes("search_memory_graph") ||
    lower.includes("user_facts") ||
    lower.includes("memory_graph")
  )
    return <Brain size={16} className="text-gray-600" />;

  // Fast web search (Exa)
  if (
    lower.includes("fast_web_search") ||
    lower.includes("web_search") ||
    lower.includes("exa")
  )
    return <Globe size={16} className="text-gray-600" />;

  // Gmail icon (square ratio)
  if (
    lower.includes("gmail") ||
    lower.includes("email") ||
    lower.includes("label") ||
    lower.includes("inbox")
  )
    return (
      <div className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/gmail.png"
          alt="Gmail"
          width={24}
          height={24}
          className="object-cover"
        />
      </div>
    );

  // Calendar icon
  if (lower.includes("calendar") || lower.includes("event"))
    return (
      <div className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/calendar.png"
          alt="Calendar"
          width={24}
          height={24}
          className="object-cover"
        />
      </div>
    );

  // Docs icon (2:3 ratio, taller)
  if (
    lower.includes("doc") ||
    lower.includes("document") ||
    lower.includes("inserttext")
  )
    return (
      <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/docs.png"
          alt="Google Docs"
          width={17}
          height={24}
          className="object-cover"
        />
      </div>
    );

  // Sheets icon
  if (
    lower.includes("sheet") ||
    lower.includes("spreadsheet") ||
    lower.includes("values")
  )
    return (
      <div className="w-5.5 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/sheets.png"
          alt="Google Sheets"
          width={24}
          height={24}
          className="object-cover"
        />
      </div>
    );

  // GitHub icon
  if (lower.includes("github"))
    return (
      <div className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/github.png"
          alt="GitHub"
          width={24}
          height={24}
          className="object-cover"
        />
      </div>
    );

  // Slack icon
  if (lower.includes("slack"))
    return (
      <div className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/slack.png"
          alt="Slack"
          width={24}
          height={24}
          className="object-cover"
        />
      </div>
    );

  // Drive icon for any other drive-related tools
  if (lower.includes("drive"))
    return (
      <div className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/drive.png"
          alt="Google Drive"
          width={24}
          height={24}
          className="object-cover"
        />
      </div>
    );

  // Notion icon
  if (lower.includes("notion"))
    return (
      <div className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center overflow-hidden p-1">
        <Image
          src="/icons/notion.png"
          alt="Notion"
          width={24}
          height={24}
          className="object-cover"
        />
      </div>
    );

  return <Sparkle size={16} className="text-gray-800" />;
}

// Normalize markdown whitespace to remove excessive blank lines and trailing spaces
function normalizeMarkdown(raw: string): string {
  if (!raw) return "";
  let s = String(raw);
  // Temporarily protect fenced code blocks to avoid altering their internal whitespace
  const codeBlocks: string[] = [];
  s = s.replace(/```[\s\S]*?```/g, (match) => {
    const index = codeBlocks.push(match) - 1;
    return `\uE000CODEBLOCK${index}\uE000`;
  });
  s = s.replace(/\r\n?/g, "\n"); // normalize line endings
  s = s.replace(/[ \t]+$/gm, ""); // trim trailing spaces on each line
  // Keep single newlines; renderer will handle soft breaks
  // If a list starts immediately after text with only a single newline, insert a blank line
  s = s.replace(/([^\n])\n([\t ]*(?:[-*+] |\d+\. ))/g, "$1\n\n$2");
  // De-indent accidental leading spaces before a new list marker after a blank line to avoid unintended nesting
  // After a blank line, de-indent accidental leading spaces before a new list marker to avoid unintended nesting
  s = s.replace(/(^|\n)\n+[\t ]+((?:[-*+] |\d+\. ))/g, "$1\n$2");
  // Collapse 2+ blank lines between list items down to a single blank line (preserve intentional spacing)
  s = s.replace(/\n(?:[\t ]*\n){2,}(?=(?:[\t ]*[-*+] |[\t ]*\d+\. ))/g, "\n\n");
  // Ensure at least one blank line after a list block
  s = s.replace(
    /((?:^|\n)(?:[\t ]*(?:[-*+] |\d+\. )).+(?:\n(?:[\t ]*(?:[-*+] |\d+\. )).+)*)\n(?!\n)/g,
    "$1\n\n",
  );
  s = s.replace(/^\n+/, "").replace(/\n+$/, ""); // trim leading/trailing blank lines
  // Restore code blocks
  s = s.replace(
    /\uE000CODEBLOCK(\d+)\uE000/g,
    (_, i) => codeBlocks[Number(i)] || "",
  );
  return s;
}

// Helpers to fix list and paragraph rendering spacing/nesting
function unwrapListItemChildren(children: React.ReactNode): React.ReactNode {
  const kids = React.Children.toArray(children);
  if (kids.length === 1) {
    const only = kids[0];
    if (React.isValidElement(only) && (only as any).type === "p") {
      const onlyProps = (only as any).props as
        | { children?: React.ReactNode }
        | undefined;
      return onlyProps && "children" in (onlyProps as any)
        ? (onlyProps as any).children
        : children;
    }
  }
  return children;
}

function ParagraphTight({ children }: { children: React.ReactNode }) {
  const kids = React.Children.toArray(children);
  if (
    kids.length === 1 &&
    React.isValidElement(kids[0]) &&
    typeof (kids[0] as any).type === "string" &&
    ["pre", "table", "ul", "ol", "blockquote"].includes(
      (kids[0] as any).type as string,
    )
  ) {
    return <>{children}</>;
  }
  return <p className="my-1 last:mb-0">{children}</p>;
}

// Gmail-like compose UI for approving sendEmail tool
function EmailComposeApproval({
  initialArgs,
  isProcessing,
  onSend,
  onCancel,
}: {
  initialArgs?: any;
  isProcessing?: boolean;
  onSend: (args: any) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState<string>(() => String(initialArgs?.to || initialArgs?.recipient || ""));
  const [subject, setSubject] = useState<string>(() => String(initialArgs?.subject || ""));
  const [body, setBody] = useState<string>(() => String(initialArgs?.body || initialArgs?.text || initialArgs?.content || ""));

  const normalizeRecipients = (value: string): string[] =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSend = () => {
    const editedArgs: any = { ...(initialArgs || {}) };

    // Ensure we only change fields that existed on the original args
    if (initialArgs && Object.prototype.hasOwnProperty.call(initialArgs, "to")) {
      if (Array.isArray(initialArgs.to)) {
        const pending = (typeof toEntry === 'string' && toEntry.trim()) ? [toEntry.trim()] : [];
        editedArgs.to = normalizeRecipients(to).concat(pending);
      } else {
        const combined = [
          ...normalizeRecipients(to),
          ...(typeof toEntry === 'string' && toEntry.trim() ? [toEntry.trim()] : []),
        ].join(", ");
        editedArgs.to = combined.trim();
      }
    } else if (initialArgs && Object.prototype.hasOwnProperty.call(initialArgs, "recipient")) {
      editedArgs.recipient = (
        (typeof toEntry === 'string' && toEntry.trim())
          ? to + (to ? ", " : "") + toEntry.trim()
          : to
      ).trim();
    }

    if (initialArgs && Object.prototype.hasOwnProperty.call(initialArgs, "subject")) {
      editedArgs.subject = subject;
    } else if (initialArgs && Object.prototype.hasOwnProperty.call(initialArgs, "title")) {
      editedArgs.title = subject;
    }

    if (initialArgs && Object.prototype.hasOwnProperty.call(initialArgs, "body")) {
      editedArgs.body = body;
    } else if (initialArgs && Object.prototype.hasOwnProperty.call(initialArgs, "text")) {
      editedArgs.text = body;
    } else if (initialArgs && Object.prototype.hasOwnProperty.call(initialArgs, "content")) {
      editedArgs.content = body;
    }

    // Explicitly remove cc/bcc to match original tool schema
    delete editedArgs.cc;
    delete editedArgs.bcc;

    onSend(editedArgs);
  };

  // Simple pill renderer for recipients
  const recipientPills = normalizeRecipients(to);
  const [toEntry, setToEntry] = useState<string>("");
  const commitToEntry = () => {
    const entry = toEntry.trim();
    if (!entry) return;
    const next = recipientPills.concat(entry).join(", ");
    setTo(next);
    setToEntry("");
  };
  const removeLastRecipient = () => {
    if (recipientPills.length === 0) return;
    const next = recipientPills.slice(0, -1).join(", ");
    setTo(next);
  };

  return (
    <div className="w-full max-w-3xl rounded-[5px] bg-[#FCFBFA] border border-gray-200">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded flex items-center justify-center overflow-hidden">
            <Image src="/icons/gmail.png" alt="Gmail" width={18} height={18} className="object-cover" />
          </div>
          <span className="text-[12px] text-gray-600">Send email</span>
        </div>

        {/* To row */}
        <div className="pb-1">
          <div className="flex items-center gap-1">
            <div className="text-[12px] text-gray-500 w-12 shrink-0">To:</div>
            <div className="flex-1">
              <div className="flex items-center flex-wrap gap-1 min-h-8 rounded-[4px] px-0 py-1">
                {recipientPills.map((addr, i) => (
                  <span key={i} className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-800">
                    {addr}
                  </span>
                ))}
                <input
                  value={toEntry}
                  onChange={(e) => setToEntry(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
                      e.preventDefault();
                      commitToEntry();
                    } else if (e.key === 'Backspace' && toEntry === '') {
                      removeLastRecipient();
                    }
                  }}
                  placeholder={recipientPills.length ? "Add recipient" : "name@example.com"}
                  className="flex-1 min-w-[220px] h-6 bg-transparent outline-none text-[12.5px] text-gray-800 placeholder-gray-400"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <div className="mt-1 h-px ml-12 mr-1 bg-gray-200/80" />
        </div>

        {/* Subject */}
        <div className="pt-1 pb-1">
          <div className="flex items-center gap-1">
            <div className="text-[12px] text-gray-500 w-12 shrink-0">Subject:</div>
            <Input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-8 text-[12.5px] font-normal rounded-[4px] bg-transparent border-none shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="mt-1 h-px ml-12 mr-1 bg-gray-200/80" />
        </div>

        {/* Body */}
        <div className="pt-1">
          <Textarea
            placeholder="Write your message..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[160px] text-[12.5px] font-normal rounded-[5px] bg-transparent border-none shadow-none focus-visible:ring-0 resize-none px-2"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-3">
          <Button
            size="sm"
            onClick={handleSend}
            disabled={isProcessing || !to.trim()}
            className="bg-[#0957D0] hover:bg-[#084dbb] disabled:bg-[#0957D0]/60 text-white text-[12px] px-3 h-7 font-normal rounded-[4px]"
          >
            {isProcessing ? "Sending..." : "Send"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={isProcessing}
            className="border-gray-300 text-gray-700 hover:bg-gray-50 text-[12px] px-3 h-7 font-normal rounded-[4px]"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// Helper function to render tool call component (UI-only refactor)
function ToolCallComponent({
  toolCall,
  onApprove,
  onReject,
  compact,
}: {
  toolCall: ToolCall;
  onApprove?: (threadId: string, toolCallId: string, editedArgs?: any) => void;
  onReject?: (threadId: string, toolCallId: string) => void;
  compact?: boolean;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Safe string conversion
  const safeString = (v: unknown, fallback = ""): string => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v == null) return fallback;
    try {
      const str = JSON.stringify(v);
      return str === "null" || str === "undefined" ? fallback : str;
    } catch {
      return fallback;
    }
  };

  // Extract core properties
  const name = safeString(
    toolCall?.name,
    toolCall?.id ? `Tool ${toolCall.id.slice(-4)}` : "Tool",
  );
  const status = safeString(toolCall?.status, "starting");
  const formattedName = formatToolName(name);

  // Simple status detection - if it's done, it's done
  const isCompleted =
    status === "completed" ||
    status === "approved" ||
    status === "parallel_completed";
  const isRunning =
    status === "starting" ||
    status === "running" ||
    status === "parallel_executing";
  const isError = status === "rejected" || status === "error";
  const isPendingApproval = status === "pending_approval";

  // Heuristic: detect email send tools reliably
  const isEmailSendTool = (() => {
    const lower = name.toLowerCase();
    const nameLooksLikeEmail =
      lower.includes("sendemail") ||
      lower.includes("send_email") ||
      /send.*email/.test(lower) ||
      /email.*send/.test(lower) ||
      lower.includes("gmail.send") ||
      lower.includes("gmailsend") ||
      lower.includes("mail.send") ||
      lower.includes("email.send");

    const args = toolCall?.args || {};
    const hasEmailishArgs =
      !!(args.to || args.recipient) && !!(args.subject || args.title) && !!(args.body || args.text || args.content);

    return nameLooksLikeEmail || hasEmailishArgs;
  })();

  // Force component re-render when tool status changes
  const [, forceUpdate] = useState({});
  useEffect(() => {
    forceUpdate({});
    if (!isPendingApproval) {
      setIsProcessing(false);
    }
  }, [toolCall.status, isPendingApproval]);

  // Handle approval actions
  const handleApprove = (editedArgs?: any) => {
    if (onApprove && toolCall.threadId && toolCall.id && !isProcessing) {
      setIsProcessing(true);
      onApprove(toolCall.threadId, toolCall.id, editedArgs);
    }
  };

  const handleReject = () => {
    if (onReject && toolCall.threadId && toolCall.id && !isProcessing) {
      setIsProcessing(true);
      onReject(toolCall.threadId, toolCall.id);
    }
  };

  // Generate display message based on current status
  const getDisplayMessage = (): React.ReactNode => {
    // When awaiting approval, we don't show a running line at all
    if (isPendingApproval) return null;

    if (isRunning) {
      const requiresApproval = toolCall.requiresApproval || false;
      if (requiresApproval) {
        return formattedName;
      }
      const phrase = buildDynamicActionPhrase(name, toolCall.args);
      const details = buildExtraDetails(name, toolCall.args);
      if (phrase || details) {
        const { phraseOut, detailsOut, showDash } = truncatePhraseAndDetails(
          phrase || formattedName,
          details,
          90,
        );
        return (
          <>
            {phraseOut}
            {detailsOut && showDash ? (
              <span className="opacity-70"> {`— ${detailsOut}`}</span>
            ) : null}
          </>
        );
      }
      return formattedName;
    }

    if (isError) {
      const base =
        toolCall.message ||
        `${formattedName} ${status === "rejected" ? "was rejected" : "error"}`;
      return truncateText(base, 90);
    }

    if (isCompleted) {
      const phrase = buildDynamicActionPhrase(name, toolCall.args);
      const details = buildExtraDetails(name, toolCall.args);
      if (phrase || details) {
        const { phraseOut, detailsOut, showDash } = truncatePhraseAndDetails(
          phrase || formattedName,
          details,
          90,
        );
        return (
          <>
            {phraseOut}
            {detailsOut && showDash ? (
              <span className="opacity-70"> {`— ${detailsOut}`}</span>
            ) : null}
          </>
        );
      }
      return formattedName;
    }

    return formattedName;
  };

  const isHumanInput =
    name.toLowerCase().includes("human_input") ||
    name.toLowerCase().includes("human input");

  // Keep a subtle, lower opacity even after completion
  const containerOpacity = "opacity-80";
  const iconOpacity = "opacity-100";
  const textColor = isCompleted ? "text-gray-800" : "text-gray-600";
  const shouldShimmer = isRunning; // Only shimmer if running

  return (
    <div className={cn("w-full my-1", compact && "ml-3", containerOpacity)}>
      {!isPendingApproval && (
        <div className="flex items-center gap-2">
          <div className={cn("mt-0.5 flex-shrink-0", iconOpacity)}>
            {getToolIcon(name)}
          </div>
          <div className="flex-1 flex items-center justify-between gap-2">
            <div
              className={cn(
                "text-[12.75px] leading-[1.35]",
                textColor,
                shouldShimmer && "shimmer-text",
              )}
            >
              {getDisplayMessage()}
            </div>
            {isHumanInput && isCompleted && (
              <button
                type="button"
                aria-label="Toggle details"
                className="text-gray-500 hover:text-gray-800"
                onClick={() => setIsOpen((v) => !v)}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    isOpen ? "rotate-180" : "rotate-0",
                  )}
                />
              </button>
            )}
          </div>
        </div>
      )}
      {isPendingApproval && (
        <div className="mt-1">
          {(() => {
            if (!isEmailSendTool) {
              return (
                <div className="flex gap-1 opacity-90">
                  <Button
                    size="sm"
                    onClick={() => handleApprove()}
                    disabled={isProcessing}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-[10px] px-2 py-0.5 h-5 font-normal"
                  >
                    {isProcessing ? "..." : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReject}
                    disabled={isProcessing}
                    className="border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 text-[10px] px-2 py-0.5 h-5 font-normal"
                  >
                    {isProcessing ? "..." : "Reject"}
                  </Button>
                </div>
              );
            }

            return (
              <EmailComposeApproval
                initialArgs={toolCall.args}
                isProcessing={isProcessing}
                onSend={(args) => handleApprove(args)}
                onCancel={handleReject}
              />
            );
          })()}
        </div>
      )}
      {isHumanInput && isCompleted && isOpen && (
        <div className="mt-1 text-[11px] text-gray-600">
          {toolCall.message && (
            <div className="opacity-80">{toolCall.message}</div>
          )}
          {toolCall.args?.input && (
            <div className="opacity-80">
              your input: {String(toolCall.args.input)}
            </div>
          )}
          {toolCall.args?.response && (
            <div className="opacity-80">
              response: {String(toolCall.args.response)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MailIcon() {
  return <Mail size={16} className="text-gray-700" />;
}
function DocIcon() {
  return <FileText size={16} className="text-gray-700" />;
}
function SheetIcon() {
  return <Table size={16} className="text-gray-700" />;
}

// Simple horizontal auto-sliding carousel for chips with no scrollbar
function AttachmentCarousel({ children, className }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const startXRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;

    const clampAndApply = (next: number) => {
      const containerWidth = container.clientWidth;
      const trackWidth = track.scrollWidth;
      const maxOffset = Math.max(0, trackWidth - containerWidth);
      const clamped = Math.min(Math.max(0, next), maxOffset);
      offsetRef.current = clamped;
      track.style.transform = `translateX(${-clamped}px)`;
    };

    const handleWheel = (e: WheelEvent) => {
      if (!container || !track) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      clampAndApply(offsetRef.current + delta);
      e.preventDefault();
    };

    const handlePointerDown = (e: PointerEvent) => {
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      startOffsetRef.current = offsetRef.current;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      container.style.cursor = "grabbing";
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - startXRef.current;
      clampAndApply(startOffsetRef.current - dx);
    };

    const handlePointerUp = (e: PointerEvent) => {
      isDraggingRef.current = false;
      container.style.cursor = "auto";
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    const handleResize = () => clampAndApply(offsetRef.current);
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    ro.observe(track);

    return () => {
      container.removeEventListener("wheel", handleWheel as any);
      container.removeEventListener("pointerdown", handlePointerDown as any);
      window.removeEventListener("pointermove", handlePointerMove as any);
      window.removeEventListener("pointerup", handlePointerUp as any);
      ro.disconnect();
    };
  }, [children]);

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden select-none", className)}
      style={{ maskImage: 'linear-gradient(90deg, rgba(0,0,0,0), black 8px, black calc(100% - 8px), rgba(0,0,0,0))' }}
    >
      <div
        ref={trackRef}
        className="inline-flex items-center gap-2 whitespace-nowrap will-change-transform"
        style={{ transform: 'translateX(0px)' }}
      >
        {children}
      </div>
    </div>
  );
}

// InlineCards moved to '@/components/InlineCards'

// Helper function to render structured content
function renderStructuredContent(
  structuredContent: MessageContent[],
  handleApprove: (threadId: string, toolCallId: string) => void,
  handleReject: (threadId: string, toolCallId: string) => void,
  options?: { suppressPrompt?: string },
) {
  if (!structuredContent || structuredContent.length === 0) {
    return null;
  }

  // Filter and sort content with approval-aware visibility
  // 1) Build a set of tool IDs that currently have pending_approval
  const pendingApprovalToolIds = new Set<string>();
  for (const part of structuredContent) {
    if (part.type === "tool_call" && part.toolCall) {
      const id =
        part.toolCall.id ||
        `anon_${part.segment}_${part.conversationRound || 1}`;
      if (part.toolCall.status === "pending_approval") {
        pendingApprovalToolIds.add(id);
      }
    }
  }

  // 2) Filter parts:
  //    - Hide starting/running only while approval is still pending
  //    - Allow starting/running after approval (when no pending_approval exists)
  //    - Keep text parts if non-empty
  const filteredContent = structuredContent
    .filter((part) => {
      if (part.type === "tool_call" && part.toolCall) {
        const id =
          part.toolCall.id ||
          `anon_${part.segment}_${part.conversationRound || 1}`;
        const status = part.toolCall.status;

        // Hide starting/running only while approval is pending for this tool
        if (
          pendingApprovalToolIds.has(id) &&
          (status === "running" || status === "starting")
        ) {
          return false;
        }
        return true;
      }

      if (part.type === "text") {
        // If requested, hide the prompt-only blockquote when inline panel is shown
        if (
          options?.suppressPrompt &&
          String(part.content).trim() === `> ${options.suppressPrompt}`
        ) {
          return false;
        }
        return (
          part.content &&
          String(part.content).trim() &&
          part.content !== "[object Object]"
        );
      }
      return false;
    })
    .sort((a, b) => {
      const roundA = a.conversationRound || 1;
      const roundB = b.conversationRound || 1;
      if (roundA !== roundB) return roundA - roundB;
      return a.segment - b.segment;
    });

  // 3) Deduplicate tool_call tiles by ID and NAME, preferring statuses by priority:
  //    completed > rejected > pending_approval > running > starting
  const statusPriority: Record<string, number> = {
    completed: 5,
    rejected: 4,
    pending_approval: 3,
    running: 2,
    starting: 1,
  };

  // Build best-per-id and best-per-name maps
  const bestToolCallById = new Map<
    string,
    { part: MessageContent; priority: number }
  >();
  const bestToolCallByName = new Map<
    string,
    { part: MessageContent; priority: number; index: number }
  >();

  filteredContent.forEach((part, index) => {
    if (part.type !== "tool_call" || !part.toolCall) return;
    const id =
      part.toolCall.id || `anon_${part.segment}_${part.conversationRound || 1}`;
    const nameKey = (part.toolCall.name || "").toLowerCase().trim();
    const prio = statusPriority[part.toolCall.status] || 0;

    const existingById = bestToolCallById.get(id);
    if (!existingById || prio > existingById.priority) {
      bestToolCallById.set(id, { part, priority: prio });
    }

    const existingByName = bestToolCallByName.get(nameKey);
    if (!existingByName || prio > existingByName.priority) {
      bestToolCallByName.set(nameKey, { part, priority: prio, index });
    }
  });

  // Only allow the best entry per tool NAME to render (prevents extra tile after approval)
  const allowedIndexes = new Set<number>(
    Array.from(bestToolCallByName.values()).map((v) => v.index),
  );

  // 4) Build final list, preserving original order but dropping non-best tool_call duplicates by name
  const validContent: MessageContent[] = [];
  const includedNames = new Set<string>();

  filteredContent.forEach((part, index) => {
    if (part.type === "text") {
      validContent.push(part);
      return;
    }
    if (part.type === "tool_call" && part.toolCall) {
      const nameKey = (part.toolCall.name || "").toLowerCase().trim();
      // Only include if this index is the selected best for this name and we haven't included it yet
      if (allowedIndexes.has(index) && !includedNames.has(nameKey)) {
        validContent.push(part);
        includedNames.add(nameKey);
      }
    }
  });

  if (validContent.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {(() => {
        const nodes: React.ReactNode[] = [];
        validContent.forEach((part, index) => {
          if (part.type === "tool_call" && part.toolCall) {
            const isParallel =
              part.toolCall.name === "parallel_tool_executor" ||
              (part.toolCall.name || "").toLowerCase().includes("parallel");
            if (isParallel) {
              nodes.push(
                <ParallelExecutionDisplay
                  key={`parallel-${part.toolCall.id || index}`}
                  toolCall={part.toolCall}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />,
              );
            } else {
              nodes.push(
                <div
                  key={`tool-${part.toolCall.id || index}`}
                  className="block my-2"
                >
                  <ToolCallComponent
                    toolCall={part.toolCall}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                </div>,
              );
            }
          } else if (part.type === "text" && part.content) {
            nodes.push(
              <div key={`text-${index}`}>
                {(() => {
                  const content = String(part.content);
                  return (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkBreaks]}
                      components={{
                        p: ({ children }) => (
                          <p className="mt-0 mb-3 last:mb-0">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="pl-5 list-disc list-outside mb-3">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="pl-5 list-decimal list-outside mb-3">{children}</ol>
                        ),
                        li: ({ children }) => <li>{unwrapListItemChildren(children)}</li>,
                      }}
                    >
                      {content}
                    </ReactMarkdown>
                  );
                })()}
              </div>,
            );
          }
        });
        return nodes;
      })()}
    </div>
  );
}

function ParallelGroupComponent({
  toolCalls,
  onApprove,
  onReject,
}: {
  toolCalls: ToolCall[];
  onApprove?: (threadId: string, toolCallId: string, editedArgs?: any) => void;
  onReject?: (threadId: string, toolCallId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  // Simple parallel group logic
  const anyRunning = toolCalls.some(
    (t) =>
      t.status === "starting" ||
      t.status === "running" ||
      t.status === "parallel_executing",
  );
  const anyCompleted = toolCalls.some(
    (t) =>
      t.status === "completed" ||
      t.status === "approved" ||
      t.status === "parallel_completed",
  );

  // Shimmer while any are running; stop only when all complete
  const allCompleted = toolCalls.every(
    (t) =>
      t.status === "completed" ||
      t.status === "approved" ||
      t.status === "parallel_completed",
  );
  const shouldShimmer = anyRunning && !allCompleted;

  const headerText = anyCompleted ? "parallel execution" : "parallel execution";

  return (
    <div className="my-2">
      <div className="flex items-center gap-2">
        <div className="mt-0.5 flex-shrink-0">
          {getToolIcon("parallel", { isParallelGroup: true })}
        </div>
        <div
          className={cn(
            "text-[13.5px] leading-[1.35]",
            anyCompleted ? "text-gray-800" : "text-gray-900",
            shouldShimmer && "shimmer-text",
          )}
        >
          {headerText}
        </div>
        <button
          type="button"
          aria-label="Toggle tools"
          className="mt-0 ml-0 -translate-y-[0.5px] -translate-x-[1px] text-gray-500 hover:text-gray-800 rounded-[4px] hover:bg-gray-100 px-0.5 py-0.5 transition-colors"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open ? "rotate-180" : "rotate-0",
            )}
          />
        </button>
      </div>
      <div
        className={cn(
          "mt-1 overflow-hidden transition-all duration-200 ease-out",
          open ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {toolCalls.map((t) => (
          <ToolCallComponent
            key={t.id}
            toolCall={t}
            onApprove={onApprove}
            onReject={onReject}
            compact
          />
        ))}
      </div>
    </div>
  );
}

function ParallelExecutionDisplay({
  toolCall,
  onApprove,
  onReject,
}: {
  toolCall: ToolCall;
  onApprove?: (threadId: string, toolCallId: string, editedArgs?: any) => void;
  onReject?: (threadId: string, toolCallId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  console.log("ParallelExecutionDisplay called with:", toolCall);
  console.log("Tool args:", toolCall.args);
  console.log("Tool message:", toolCall.message);

  // More flexible detection
  const isParallelTool =
    toolCall.name === "parallel_tool_executor" ||
    toolCall.name?.includes("parallel");

  if (!isParallelTool) {
    console.log("Not a parallel tool:", toolCall.name);
    return null;
  }

  // Try to extract tools from different places
  let subTools: Array<{ tool_name: string; args: any }> = [];

  // Method 1: Direct from args
  if (toolCall.args?.tools_to_execute) {
    subTools = toolCall.args.tools_to_execute;
    console.log("Found tools in args:", subTools);
  }
  // Method 2: Parse from args.input JSON string (this is where the real data is!)
  else if (toolCall.args?.input) {
    try {
      const parsed = JSON.parse(toolCall.args.input);
      if (parsed.tools_to_execute) {
        subTools = parsed.tools_to_execute;
        console.log("Found tools in args.input:", subTools);
      }
    } catch (e) {
      console.log("Failed to parse args.input as JSON:", e);
    }
  }
  // Method 3: Parse from JSON string in args
  else if (typeof toolCall.args === "string") {
    try {
      const parsed = JSON.parse(toolCall.args);
      if (parsed.tools_to_execute) {
        subTools = parsed.tools_to_execute;
        console.log("Found tools in parsed args:", subTools);
      }
    } catch (e) {
      console.log("Failed to parse args as JSON:", e);
    }
  }
  // Method 4: Parse from message content
  else if (toolCall.message) {
    try {
      // Look for tool names in the message
      const toolMatches = toolCall.message.match(/\*\*([^*]+)\*\*/g);
      if (toolMatches) {
        subTools = toolMatches.map((match, index) => ({
          tool_name: match.replace(/\*\*/g, ""),
          args: {},
        }));
        console.log("Found tools in message:", subTools);
      }
    } catch (e) {
      console.log("Failed to parse message:", e);
    }
  }

  // If still no tools found, show debug info
  if (!subTools || subTools.length === 0) {
    return (
      <div className="my-2 p-2 bg-red-100 border border-red-300 rounded">
        <div className="text-sm text-red-800 font-mono">
          <div>Debug: No tools found in parallel execution</div>
          <div>Tool name: {toolCall.name}</div>
          <div>Args type: {typeof toolCall.args}</div>
          <div>Args: {JSON.stringify(toolCall.args, null, 2)}</div>
          <div>Message: {toolCall.message}</div>
        </div>
      </div>
    );
  }

  const isRunning = ["starting", "running"].includes(toolCall.status);

  const headerText = isRunning
    ? `Executing ${subTools.length} tools in parallel`
    : `Executed ${subTools.length} tools in parallel`;

  // Pending approval: show only Approve/Reject buttons (no header/label)
  if (toolCall.status === "pending_approval") {
    return (
      <div className="my-2">
        <div className="mt-2 flex gap-2 opacity-90">
          <button
            onClick={() =>
              onApprove &&
              toolCall.threadId &&
              onApprove(toolCall.threadId, toolCall.id)
            }
            className="bg-green-600 hover:bg-green-700 text-white text-[10px] px-2 py-0.5 h-5 font-normal rounded"
          >
            Approve
          </button>
          <button
            onClick={() =>
              onReject &&
              toolCall.threadId &&
              onReject(toolCall.threadId, toolCall.id)
            }
            className="border border-red-200 text-red-700 hover:bg-red-50 text-[10px] px-2 py-0.5 h-5 font-normal rounded"
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2">
      <div className="flex items-center gap-2">
        <div className="mt-0.5 flex-shrink-0">
          <Waypoints size={16} className="text-gray-600" />
        </div>
        <div
          className={cn(
            "text-[13.5px] text-gray-900 leading-[1.35]",
            isRunning && "shimmer-text",
          )}
        >
          {headerText}
        </div>
        <button
          type="button"
          aria-label="Toggle tools"
          className="mt-0 ml-0 -translate-y-[0.5px] -translate-x-[1px] text-gray-500 hover:text-gray-800 rounded-[4px] hover:bg-gray-100 px-0.5 py-0.5 transition-colors"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open ? "rotate-180" : "rotate-0",
            )}
          />
        </button>
      </div>
      <div
        className={cn(
          "mt-1 ml-3.5 overflow-hidden transition-all duration-200 ease-out",
          open ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {subTools.map((subTool: any, subIndex: number) => {
          const subToolCall: ToolCall = {
            id: `${toolCall.id}-sub-${subIndex}`,
            name: subTool.tool_name,
            status:
              toolCall.status === "running"
                ? "running"
                : toolCall.status === "completed"
                  ? "completed"
                  : toolCall.status,
            args: subTool.args,
            segment: toolCall.segment,
          };

          return (
            <ToolCallComponent
              key={`subtool-${subToolCall.id}`}
              toolCall={subToolCall}
              onApprove={onApprove}
              onReject={onReject}
              compact
            />
          );
        })}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    messages: aiMessages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    cancelRequest,
    approveToolCall,
    pendingApproval,
    pendingHumanInput,
    submitHumanInput,
  } = useAIChat();
  const visibleMessages = aiMessages.filter((m) => !m.hidden);
  const prevMessageCountRef = useRef<number>(visibleMessages.length);
  const [mode, setMode] = useState<"act" | "talk">("talk");
  const [displayMode, setDisplayMode] = useState<"act" | "talk">("talk");
  const [isAnimating, setIsAnimating] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState<number>(0);
  const prevComposerHeightRef = useRef<number>(0);

  useEffect(() => {
    if (mode !== displayMode) {
      setDisplayMode(mode); // Switch text FIRST
      // Wait for next tick to trigger animation on new text
      setTimeout(() => {
        setIsAnimating(true);
        const timer = setTimeout(() => {
          setIsAnimating(false);
        }, 1200); // Match the animation duration (1.2s)
        // Clean up
        return () => clearTimeout(timer);
      }, 10); // Small delay to ensure DOM updates
    }
  }, [mode, displayMode]);
  useEffect(() => {
    if (!composerRef.current || typeof window === "undefined") return;
    const node = composerRef.current;
    const updateHeight = () => {
      const next = node.offsetHeight || 0;
      const prev = prevComposerHeightRef.current || 0;
      if (next !== prev) {
        // If user is near bottom, compensate scroll so messages don't jump
        const distanceFromBottom =
          document.documentElement.scrollHeight -
          (window.scrollY + window.innerHeight);
        const isNearBottom = distanceFromBottom < 80;
        setComposerHeight(next);
        if (isNearBottom) {
          const delta = next - prev;
          if (delta !== 0) {
            requestAnimationFrame(() => window.scrollBy({ top: delta, behavior: "auto" }));
          }
        }
        prevComposerHeightRef.current = next;
      }
    };
    updateHeight();
    const ro = new ResizeObserver(() => updateHeight());
    ro.observe(node);
    window.addEventListener("resize", updateHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  // Re-center the fixed composer to the visual center of the chat column
  useEffect(() => {
    const updateComposerLeft = () => {
      if (!columnRef.current || !composerRef.current) return;
      const rect = columnRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2; // viewport coords
      composerRef.current.style.left = `${centerX}px`;
    };

    updateComposerLeft();

    const ro = new ResizeObserver(() => updateComposerLeft());
    if (columnRef.current) ro.observe(columnRef.current);
    window.addEventListener("resize", updateComposerLeft);
    // Optional: allow sidebar to dispatch a custom event when toggled
    window.addEventListener("sidebar:toggle" as any, updateComposerLeft);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateComposerLeft);
      window.removeEventListener("sidebar:toggle" as any, updateComposerLeft);
    };
  }, []);
  const scrollToBottomNow = (behavior: "auto" | "smooth" = "auto") => {
    // Use double RAF to ensure layout committed before scrolling
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior,
            });
          } catch {
            // no-op
          }
          messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
        });
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    // Reset input immediately for better UX
    const userInput = input;
    setInput("");

    // Scroll to bottom right away so textbox moves down with the page
    scrollToBottomNow("auto");

    // Send the message to the AI with persona/references
    await sendMessage(userInput, {
      personaOverrideContent: selectedPersona?.content,
      references: references.map(({ app, type, id, name }) => ({ app, type, id, name })),
    });

    // Smooth scroll again after message is queued/rendered
    scrollToBottomNow("smooth");
  };

  const handleApprove = (
    threadId: string,
    toolCallId: string,
    editedArgs?: any,
  ) => {
    approveToolCall(threadId, toolCallId, "approve", editedArgs);
  };

  const handleReject = (threadId: string, toolCallId: string) => {
    approveToolCall(threadId, toolCallId, "reject");
  };

  // Scroll only once when a new message is added (no streaming/typing auto-scroll)
  useEffect(() => {
    if (visibleMessages.length > prevMessageCountRef.current) {
      scrollToBottomNow();
    }
    prevMessageCountRef.current = visibleMessages.length;
  }, [visibleMessages.length]);

  useEffect(() => {
    const eventSource = new EventSource("/api/chat");

    eventSource.addEventListener("plan", (event) => {
      const data = JSON.parse(event.data);
      const toolCall: ToolCall = {
        id: "planner",
        name: "planner",
        status: "completed",
        args: { tasks: data.tasks },
        message: data.content,
        segment: 0,
      };
      // You would typically update your messages state here
      // For example: setAiMessages(prev => [...prev, { role: 'assistant', toolCalls: [toolCall] }]);
    });

    eventSource.addEventListener("reflection", (event) => {
      const data = JSON.parse(event.data);
      const toolCall: ToolCall = {
        id: "reflector",
        name: "reflector",
        status: "completed",
        args: {},
        message: data.content,
        segment: 0,
      };
      // You would typically update your messages state here
      // For example: setAiMessages(prev => [...prev, { role: 'assistant', toolCalls: [toolCall] }]);
    });

    return () => {
      eventSource.close();
    };
  }, []);

  const [humanInputValue, setHumanInputValue] = useState("");
  // Composer chips and slash stages
  const [selectedPersona, setSelectedPersona] = useState<{ id: string; name: string; content: string } | null>(null);
  const [references, setReferences] = useState<Array<{ app: string; type?: string; id: string; name?: string; icon?: string }>>([]);

  type SlashStage = "root" | "persona" | "apps" | "docs" | "sheets" | "gmail";
  const [slashStage, setSlashStage] = useState<SlashStage>("root");
  const [personaOptions, setPersonaOptions] = useState<Array<{ id: string; name: string; content: string }>>([]);
  const [personaIndex, setPersonaIndex] = useState(0); // legacy (unused for navigation)
  const [personaMenuIndex, setPersonaMenuIndex] = useState(1);
  const [appOptions, setAppOptions] = useState<Array<{ app: string; hasValidToken?: boolean }>>([]);
  const [appsMenuIndex, setAppsMenuIndex] = useState(1);
  const [docsOptions, setDocsOptions] = useState<Array<{ id: string; name: string; icon?: string }>>([]);
  const [docsMenuIndex, setDocsMenuIndex] = useState(1);
  const [docsQuery, setDocsQuery] = useState("");
  const [sheetsOptions, setSheetsOptions] = useState<Array<{ id: string; name: string; icon?: string }>>([]);
  const [sheetsMenuIndex, setSheetsMenuIndex] = useState(1);
  const [sheetsQuery, setSheetsQuery] = useState("");
  const [gmailOptions, setGmailOptions] = useState<Array<{ id: string; subject: string; from?: string; snippet?: string }>>([]);
  const [gmailMenuIndex, setGmailMenuIndex] = useState(1);
  const [gmailQuery, setGmailQuery] = useState("");

  // Slash commands state
  const [slashSelectedIndex, setSlashSelectedIndex] = useState<number>(0);
  const [slashVisible, setSlashVisible] = useState<boolean>(false);
  const isSlashOpen = (input.startsWith("/") || slashStage !== "root") && !pendingApproval && slashVisible;
  const slashQuery = input.startsWith("/") ? input.slice(1).trim().toLowerCase() : "";

  const resetSlashMenu = () => {
    setSlashStage("root");
    setSlashVisible(false);
    setSlashSelectedIndex(0);
    setPersonaMenuIndex(1);
    setAppsMenuIndex(1);
    setDocsMenuIndex(1);
    setSheetsMenuIndex(1);
    setGmailMenuIndex(1);
    setDocsQuery("");
    setSheetsQuery("");
    setGmailQuery("");
  };

  type SlashCommand = {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    insertText: string;
    keywords?: string[];
  };

  const slashCommands: SlashCommand[] = [
    {
      id: "persona",
      title: "Persona",
      description: "Reference your saved personas",
      icon: <BookOpen className="h-4 w-4 text-gray-700" />,
      insertText: "/persona ",
      keywords: ["prompt", "rules", "voice"],
    },
    {
      id: "apps",
      title: "Reference apps",
      description: "Attach context from your apps",
      icon: <LayoutGrid className="h-4 w-4 text-gray-700" />,
      insertText: "/apps ",
      keywords: ["docs", "sheets", "gmail", "calendar", "drive"],
    },
  ];

  const filteredSlashCommands = slashCommands.filter((cmd) => {
    if (!slashQuery) return true;
    const hay = `${cmd.title} ${cmd.description} ${(cmd.keywords || []).join(" ")}`.toLowerCase();
    return hay.includes(slashQuery);
  });

  useEffect(() => {
    // Reset selection when filter changes
    setSlashSelectedIndex(0);
  }, [slashQuery]);

  const applySlashCommand = (cmd: SlashCommand) => {
    // Enter sub-stages for persona/apps; otherwise just insert
    if (cmd.id === "persona") {
      setSlashStage("persona");
      setSlashVisible(true);
      // Load personas
      fetch("/api/prompts", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: any) => {
          const list = (data.prompts || []).map((p: any) => ({ id: p.id, name: p.name, content: p.content }));
          setPersonaOptions(list);
          setPersonaIndex(0);
        })
        .catch(() => {});
      return;
    }
    if (cmd.id === "apps") {
      setSlashStage("apps");
      setSlashVisible(true);
      // Load connected apps
      fetch("/api/integrations/connected-apps", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: any) => {
          const list = (data.connectedApps || []).map((a: any) => ({ app: a.app, hasValidToken: a.hasValidToken }));
          setAppOptions(list);
          setAppsMenuIndex(1);
        })
        .catch(() => {});
      return;
    }
    setInput(cmd.insertText);
    setSlashSelectedIndex(0);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pendingApproval) {
      e.preventDefault();
      return;
    }
    // Stage-specific navigation
    if (slashStage === "persona" && isSlashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setPersonaMenuIndex((i) => Math.min(i + 1, personaOptions.length)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setPersonaMenuIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const choice = personaOptions[Math.max(0, personaMenuIndex - 1)];
        if (choice) {
          setSelectedPersona(choice);
          setSlashStage("root");
          setInput("");
        }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); resetSlashMenu(); return; }
    }
    if (slashStage === "apps" && isSlashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAppsMenuIndex((i) => Math.min(i + 1, appOptions.length)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAppsMenuIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const choice = appOptions[Math.max(0, appsMenuIndex - 1)];
        if (choice?.app?.toLowerCase() === "docs") {
          setSlashStage("docs");
          // Load initial docs
          fetch(`/api/apps/docs/list`)
            .then((r) => r.json())
            .then((data: any) => {
              setDocsOptions((data.items || []).map((d: any) => ({ id: d.id, name: d.name, icon: d.icon })));
              setDocsMenuIndex(1);
            })
            .catch(() => {});
        } else if (choice?.app?.toLowerCase() === "sheets") {
          setSlashStage("sheets");
          fetch(`/api/apps/sheets/list`)
            .then((r) => r.json())
            .then((data: any) => {
              setSheetsOptions((data.items || []).map((d: any) => ({ id: d.id, name: d.name, icon: "/icons/sheets.png" })));
              setSheetsMenuIndex(1);
            })
            .catch(() => {});
        } else if (choice?.app?.toLowerCase() === "gmail") {
          setSlashStage("gmail");
          fetch(`/api/apps/gmail/list`)
            .then((r) => r.json())
            .then((data: any) => {
              setGmailOptions((data.items || []).map((m: any) => ({ id: m.id, subject: m.subject || m.snippet || m.id, from: m.from, snippet: m.snippet })));
              setGmailMenuIndex(1);
            })
            .catch(() => {});
        } else {
          // Other apps not yet implemented: close stage
          setSlashStage("root");
        }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); resetSlashMenu(); return; }
    }
    if (slashStage === "docs" && isSlashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setDocsMenuIndex((i) => Math.min(i + 1, docsOptions.length)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setDocsMenuIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const choice = docsOptions[Math.max(0, docsMenuIndex - 1)];
        if (choice) {
          setReferences((prev) => [...prev, { app: "docs", type: "document", id: choice.id, name: choice.name, icon: "/icons/docs.png" }]);
          setSlashStage("root");
          setDocsQuery("");
          setInput("");
        }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setDocsQuery(""); resetSlashMenu(); return; }
      // Typing to filter docs
      const key = e.key;
      if (key.length === 1 || key === "Backspace") {
        // Let input change happen first then react in onChange
        setTimeout(() => {
          const q = (document.activeElement as HTMLTextAreaElement)?.value || "";
          setDocsQuery(q.trim());
        }, 0);
      }
      // Prevent submitting while in docs stage using Enter handled above
    }
    if (slashStage === "sheets" && isSlashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSheetsMenuIndex((i) => Math.min(i + 1, sheetsOptions.length)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSheetsMenuIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const choice = sheetsOptions[Math.max(0, sheetsMenuIndex - 1)];
        if (choice) {
          setReferences((prev) => [...prev, { app: "sheets", type: "spreadsheet", id: choice.id, name: choice.name, icon: "/icons/sheets.png" }]);
          setSlashStage("root");
          setSheetsQuery("");
          setInput("");
        }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setSheetsQuery(""); resetSlashMenu(); return; }
      const key = e.key;
      if (key.length === 1 || key === "Backspace") {
        setTimeout(() => {
          const q = (document.activeElement as HTMLTextAreaElement)?.value || "";
          setSheetsQuery(q.trim());
        }, 0);
      }
    }
    if (slashStage === "gmail" && isSlashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setGmailMenuIndex((i) => Math.min(i + 1, gmailOptions.length)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setGmailMenuIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const choice = gmailOptions[Math.max(0, gmailMenuIndex - 1)];
        if (choice) {
          setReferences((prev) => [...prev, { app: "gmail", type: "email", id: choice.id, name: choice.subject, icon: "/icons/gmail.png" }]);
          setSlashStage("root");
          setGmailQuery("");
          setInput("");
        }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setGmailQuery(""); resetSlashMenu(); return; }
      const key = e.key;
      if (key.length === 1 || key === "Backspace") {
        setTimeout(() => {
          const q = (document.activeElement as HTMLTextAreaElement)?.value || "";
          setGmailQuery(q.trim());
        }, 0);
      }
    }
    if (slashStage === "root" && isSlashOpen && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredSlashCommands[slashSelectedIndex] || filteredSlashCommands[0];
        if (cmd) applySlashCommand(cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput(""); resetSlashMenu();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const formEvent = new Event("submit", { cancelable: true }) as unknown as React.FormEvent<HTMLFormElement>;
      handleSubmit(formEvent);
    }
  };

  // Fetch docs when docsQuery changes
  useEffect(() => {
    if (slashStage !== "docs") return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      const url = docsQuery ? `/api/apps/docs/list?q=${encodeURIComponent(docsQuery)}` : `/api/apps/docs/list`;
      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: any) => {
          setDocsOptions((data.items || []).map((d: any) => ({ id: d.id, name: d.name, icon: d.icon })));
          setDocsMenuIndex(1);
        })
        .catch(() => {});
    }, 200);
    return () => { clearTimeout(id); controller.abort(); };
  }, [slashStage, docsQuery]);

  // Fetch sheets when sheetsQuery changes
  useEffect(() => {
    if (slashStage !== "sheets") return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      const url = sheetsQuery ? `/api/apps/sheets/list?q=${encodeURIComponent(sheetsQuery)}` : `/api/apps/sheets/list`;
      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: any) => {
          setSheetsOptions((data.items || []).map((d: any) => ({ id: d.id, name: d.name, icon: "/icons/sheets.png" })));
          setSheetsMenuIndex(1);
        })
        .catch(() => {});
    }, 200);
    return () => { clearTimeout(id); controller.abort(); };
  }, [slashStage, sheetsQuery]);

  // Fetch gmail when gmailQuery changes
  useEffect(() => {
    if (slashStage !== "gmail") return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      const url = gmailQuery ? `/api/apps/gmail/list?q=${encodeURIComponent(gmailQuery)}` : `/api/apps/gmail/list`;
      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: any) => {
          setGmailOptions((data.items || []).map((m: any) => ({ id: m.id, subject: m.subject || m.snippet || m.id, from: m.from, snippet: m.snippet })));
          setGmailMenuIndex(1);
        })
        .catch(() => {});
    }, 200);
    return () => { clearTimeout(id); controller.abort(); };
  }, [slashStage, gmailQuery]);

  // Build stage-specific menu items
  type MenuItem = { id: string; title: string; description?: string; icon?: React.ReactNode };
  let menuItems: MenuItem[] = [];
  let menuSelectedIndex = 0;
  let onMenuSelect: (item: MenuItem, index: number) => void = () => {};
  let onMenuHoverIndexChange: (index: number) => void = () => {};

  if (slashStage === "root") {
    menuItems = filteredSlashCommands.map((c) => ({ id: c.id, title: c.title, description: c.description, icon: c.icon }));
    menuSelectedIndex = slashSelectedIndex;
    onMenuSelect = (item) => {
      const cmd = slashCommands.find((c) => c.id === item.id);
      if (cmd) applySlashCommand(cmd);
    };
    onMenuHoverIndexChange = setSlashSelectedIndex;
  } else if (slashStage === "persona") {
    menuItems = [
      { id: "__back", title: "← Back", description: "Return" },
      ...personaOptions.map((p) => ({ id: p.id, title: p.name, description: p.content?.slice(0, 80) })),
    ];
    menuSelectedIndex = Math.min(personaMenuIndex, menuItems.length - 1);
    onMenuSelect = (_item, idx) => {
      if (idx === 0) { setSlashStage("root"); setSlashSelectedIndex(0); return; }
      const choice = personaOptions[idx - 1];
      if (choice) {
        setSelectedPersona(choice);
        resetSlashMenu();
        setInput("");
      }
    };
    onMenuHoverIndexChange = (i) => setPersonaMenuIndex(i);
  } else if (slashStage === "apps") {
    menuItems = [
      { id: "__back", title: "← Back", description: "Return" },
      ...appOptions.map((a) => ({
      id: a.app,
      title: a.app.charAt(0).toUpperCase() + a.app.slice(1),
      description: a.hasValidToken ? "Connected" : "Reconnect required",
      icon: (
        a.app.toLowerCase() === "docs" ? <Image src="/icons/docs.png" alt="docs" width={16} height={16} /> :
        a.app.toLowerCase() === "sheets" ? <Image src="/icons/sheets.png" alt="sheets" width={16} height={16} /> :
        a.app.toLowerCase() === "gmail" ? <Image src="/icons/gmail.png" alt="gmail" width={16} height={16} className="relative top-[1px]" /> :
        a.app.toLowerCase() === "drive" ? <Image src="/icons/drive.png" alt="drive" width={16} height={16} /> :
        <Sparkle className="h-4 w-4" />
      ),
    }))
    ];
    menuSelectedIndex = Math.min(appsMenuIndex, menuItems.length - 1);
    onMenuSelect = (_item, idx) => {
      if (idx === 0) { setSlashStage("root"); setSlashSelectedIndex(0); return; }
      const choice = appOptions[idx - 1];
      if (!choice) return;
      if (choice.app.toLowerCase() === "docs") {
        setSlashStage("docs");
        fetch(`/api/apps/docs/list`).then((r) => r.json()).then((data: any) => {
          setDocsOptions((data.items || []).map((d: any) => ({ id: d.id, name: d.name, icon: d.icon })));
          setDocsMenuIndex(1);
        }).catch(() => {});
      } else if (choice.app.toLowerCase() === "sheets") {
        setSlashStage("sheets");
        fetch(`/api/apps/sheets/list`).then((r) => r.json()).then((data: any) => {
          setSheetsOptions((data.items || []).map((d: any) => ({ id: d.id, name: d.name, icon: "/icons/sheets.png" })));
          setSheetsMenuIndex(1);
        }).catch(() => {});
      } else if (choice.app.toLowerCase() === "gmail") {
        setSlashStage("gmail");
        fetch(`/api/apps/gmail/list`).then((r) => r.json()).then((data: any) => {
          setGmailOptions((data.items || []).map((m: any) => ({ id: m.id, subject: m.subject || m.snippet || m.id, from: m.from, snippet: m.snippet })));
          setGmailMenuIndex(1);
        }).catch(() => {});
      } else {
        resetSlashMenu();
      }
    };
    onMenuHoverIndexChange = (i) => setAppsMenuIndex(i);
  } else if (slashStage === "docs") {
    menuItems = [
      { id: "__back", title: "← Back", description: "Return" },
      ...docsOptions.map((d) => ({ id: d.id, title: d.name, icon: <Image src="/icons/docs.png" alt="docs" width={16} height={16} /> })),
    ];
    menuSelectedIndex = Math.min(docsMenuIndex, menuItems.length - 1);
    onMenuSelect = (_item, idx) => {
      if (idx === 0) { setSlashStage("apps"); setAppsMenuIndex(1); return; }
      const choice = docsOptions[idx - 1];
      if (choice) {
        setReferences((prev) => [...prev, { app: "docs", type: "document", id: choice.id, name: choice.name, icon: "/icons/docs.png" }]);
        resetSlashMenu();
        setDocsQuery("");
        setInput("");
      }
    };
    onMenuHoverIndexChange = (i) => setDocsMenuIndex(i);
  } else if (slashStage === "sheets") {
    menuItems = [
      { id: "__back", title: "← Back", description: "Return" },
      ...sheetsOptions.map((s) => ({ id: s.id, title: s.name, icon: <Image src="/icons/sheets.png" alt="sheets" width={16} height={16} /> })),
    ];
    menuSelectedIndex = Math.min(sheetsMenuIndex, menuItems.length - 1);
    onMenuSelect = (_item, idx) => {
      if (idx === 0) { setSlashStage("apps"); setAppsMenuIndex(1); return; }
      const choice = sheetsOptions[idx - 1];
      if (choice) {
        setReferences((prev) => [...prev, { app: "sheets", type: "spreadsheet", id: choice.id, name: choice.name, icon: "/icons/sheets.png" }]);
        resetSlashMenu();
        setSheetsQuery("");
        setInput("");
      }
    };
    onMenuHoverIndexChange = (i) => setSheetsMenuIndex(i);
  } else if (slashStage === "gmail") {
    menuItems = [
      { id: "__back", title: "← Back", description: "Return" },
      ...gmailOptions.map((m) => ({ id: m.id, title: m.subject || m.id, description: m.from || m.snippet, icon: <Image src="/icons/gmail.png" alt="gmail" width={16} height={16} className="relative top-[1px]" /> })),
    ];
    menuSelectedIndex = Math.min(gmailMenuIndex, menuItems.length - 1);
    onMenuSelect = (_item, idx) => {
      if (idx === 0) { setSlashStage("apps"); setAppsMenuIndex(1); return; }
      const choice = gmailOptions[idx - 1];
      if (choice) {
        setReferences((prev) => [...prev, { app: "gmail", type: "email", id: choice.id, name: choice.subject, icon: "/icons/gmail.png" }]);
        resetSlashMenu();
        setGmailQuery("");
        setInput("");
      }
    };
    onMenuHoverIndexChange = (i) => setGmailMenuIndex(i);
  }

  return (
    <div className="flex flex-col min-h-screen p-6 relative">
      <div
        ref={columnRef}
        className={`w-full max-w-2xl mx-auto flex flex-col ${visibleMessages.length > 0 ? "" : "justify-center"}`}
      >
        {visibleMessages.length === 0 ? (
          <div className="w-full">
            <div className="text-center mb-6 mt-[35vh]">
              <div className="flex items-center justify-center space-x-2">
                <Sparkle
                  size={22}
                  strokeWidth={1.0}
                  className={`text-gray-900 fill-current ${isAnimating ? "rotating-logo" : ""} ${mode === "act" ? "rotate-[360deg]" : "rotate-0"}`}
                />
                <h2
                  ref={headingRef}
                  className="text-2xl font-normal text-gray-900 relative overflow-hidden"
                  style={{ fontFamily: "var(--font-merriweather), serif" }}
                >
                  <div className="relative inline-block">
                    <span
                      className={`chroma-text ${isAnimating ? "animate-gradient-sweep" : "animation-complete"}`}
                    >
                      {displayMode === "act"
                        ? "What's the task for today?"
                        : "How can I help?"}
                    </span>
                  </div>
                </h2>
              </div>
            </div>

            {/* Composer lowered on empty state */}
            <div className="relative left-[50%] -translate-x-1/2 w-[calc(100%-3rem)] max-w-2xl">
              <form onSubmit={handleSubmit} className="w-full">
                {error && (
                  <div className="text-red-500 text-sm mb-2 p-2 bg-red-50 rounded">
                    {error}
                  </div>
                )}
                <div className="relative">
                  {(selectedPersona || references.length > 0) && (
                    <AttachmentCarousel className="absolute left-2 right-10 -top-7">
                      {selectedPersona && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[12px] border border-gray-200">
                          <User className="h-3.5 w-3.5" />
                          <span>Persona: {selectedPersona.name}</span>
                          <button type="button" className="ml-1 text-gray-500 hover:text-gray-800" onClick={() => setSelectedPersona(null)} aria-label="Remove persona">×</button>
                        </span>
                      )}
                      {references.map((ref, idx) => (
                        <span key={`${ref.app}-${ref.id}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[12px] border border-gray-200">
                          {ref.icon ? (
                            <Image src={ref.icon} alt={ref.app} width={14} height={14} />
                          ) : (
                            <Sparkle className="h-3.5 w-3.5" />
                          )}
                          <span>{ref.name || `${ref.app} item`}</span>
                          <button type="button" className="ml-1 text-gray-500 hover:text-gray-800" onClick={() => setReferences((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remove reference">×</button>
                        </span>
                      ))}
                    </AttachmentCarousel>
                  )}
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={"Type @ to reference apps and more..."}
                    className="min-h-[44px] pl-4 pr-10 pt-2.5 resize-none border-gray-200 hover:border-gray-300 focus:!outline-none focus:!ring-0 focus:!ring-offset-0 focus:!ring-transparent focus:!border-gray-200 rounded-[5px] placeholder-gray-300"
                    rows={1}
                    onKeyDown={handleTextareaKeyDown}
                    onFocus={() => setSlashVisible(true)}
                    onBlur={resetSlashMenu}
                    disabled={isLoading || !!pendingApproval}
                  />

                  {isSlashOpen && (
                    <SlashCommandsMenu
                      items={menuItems}
                      selectedIndex={menuSelectedIndex}
                      onSelect={(item, index) => onMenuSelect(item as any, index)}
                      onHoverIndexChange={onMenuHoverIndexChange}
                    />
                  )}

                  <div className="absolute right-3 bottom-2.5">
                    {isLoading ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 -mt-2 mb-0.5 flex items-center justify-center rounded-sm bg-red-400 hover:bg-red-500 text-white text-xs"
                        onClick={() => cancelRequest()}
                      />
                    ) : (
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 -m-1 flex items-center justify-center rounded-sm hover:bg-transparent"
                        disabled={!input.trim() || !!pendingApproval}
                      >
                        <CornerDownLeft className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex mt-2 space-x-2">
                  <div>
                    <ModeSwitcher mode={mode} setMode={setMode} />
                  </div>
                  <div className="flex-1 flex justify-between">
                    <div className="flex gap-2">
                      <HumanInTheLoopDropdown />
                      <ParallelExecutionDropdown />
                    </div>
                    <button className="flex items-center pl-3 pr-1.5 h-8 text-[13.5px] font-normal text-gray-900 bg-gray-50 rounded-[5px] hover:bg-gray-100 focus:outline-none">
                      <div className="flex items-center">
                        <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
                        <span>Upload</span>
                      </div>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="bg-[#FCFBFA] mt-15 pb-4 pr-4 w-full">
            {/* Custom scrollbar and animation styles */}
            <style jsx global>{`
              .overflow-y-auto {
                scrollbar-width: thin;
                scrollbar-color: transparent transparent;
                transition: scrollbar-color 0.3s ease;
              }
              .overflow-y-auto:hover {
                scrollbar-color: #d1d5db transparent;
              }
              .overflow-y-auto::-webkit-scrollbar {
                width: 4px;
              }
              .overflow-y-auto::-webkit-scrollbar-track {
                background: transparent;
              }
              .overflow-y-auto::-webkit-scrollbar-thumb {
                background-color: transparent;
                border-radius: 4px;
                transition: background-color 0.3s ease;
              }
              .overflow-y-auto:hover::-webkit-scrollbar-thumb {
                background-color: #d1d5db;
              }
              @keyframes spin-slow {
                from {
                  transform: rotate(0deg);
                }
                to {
                  transform: rotate(360deg);
                }
              }
              .animate-spin-slow {
                animation: spin-slow 1.5s linear infinite;
              }
              @keyframes smooth-bounce {
                0%,
                80%,
                100% {
                  transform: translateY(0);
                }
                40% {
                  transform: translateY(-6px);
                }
              }
              .animate-smooth-bounce {
                animation: smooth-bounce 1.4s ease-in-out infinite;
              }
              @keyframes shimmer {
                0% {
                  background-position: -200px 0;
                }
                100% {
                  background-position: calc(200px + 100%) 0;
                }
              }
              .shimmer-text {
                background: linear-gradient(
                  90deg,
                  #000000 35%,
                  #ffffff 50%,
                  #000000 65%
                );
                background-size: 400px 100%;
                animation: shimmer 1.5s infinite linear;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                font-weight: 300;
              }
              @keyframes scale-fade {
                0% {
                  opacity: 0;
                  transform: scale(0.98) translateY(4px);
                }
                100% {
                  opacity: 1;
                  transform: scale(1) translateY(0);
                }
              }
              .animate-scale-fade {
                animation: scale-fade 120ms ease-out;
              }
            `}</style>
            <div className="max-w-2xl mx-auto">
            <div style={{ paddingBottom: composerHeight ? composerHeight + 220 : 320 }}>
            {visibleMessages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-start gap-3",
                  message.role === "user"
                    ? "flex-row-reverse ml-auto"
                    : "mr-auto",
                  "mb-6 last:mb-0", // Increased bottom margin for all messages
                  message.role === "assistant" && "mb-12", // Even more space after AI messages
                  "group/message",
                  message.role === "user" && "mt-1", // Slight upward nudge for user messages
                )}
              >
                {message.role === "user" ? (
                  <div className="w-full flex justify-end">
                    <div className="flex max-w-[98%]">
                      <div className={cn("px-3 py-1.5 bg-[#EDEBE6] text-gray-900 rounded-lg","min-h-[28px]","break-words","w-full","mt-0")}> 
                        {(() => {
                          const text = String(message.content || "");
                          const attStart = text.indexOf("[attachments]");
                          const attEnd = text.indexOf("[/attachments]");
                          let mainText = text;
                          let attachments: any[] | null = null;
                          if (attStart !== -1 && attEnd !== -1 && attEnd > attStart) {
                            mainText = (text.slice(0, attStart) + text.slice(attEnd + "[/attachments]".length)).replace(/\s{2,}/g, ' ').trim();
                            const jsonBlock = text.slice(attStart + "[attachments]".length, attEnd).trim();
                            try { attachments = JSON.parse(jsonBlock); } catch {}
                          }
                          return (
                            <div className="text-sm leading-snug break-words">
                              {mainText}
                              {Array.isArray(attachments) && attachments.length > 0 && (
                                <>
                                  {' '}
                                  <AttachmentCarousel className="mt-1">
                                    {attachments.map((att, i) => (
                                      <span key={i} className="inline-flex align-middle items-center gap-1 px-2 py-0.5 rounded-md text-[12px] text-gray-800 ml-1 mr-0.5">
                                        {(() => {
                                          const app = String(att.app || "").toLowerCase();
                                          if (app === "docs") return <Image src="/icons/docs.png" alt="docs" width={13} height={13} />;
                                          if (app === "sheets") return <Image src="/icons/sheets.png" alt="sheets" width={13} height={13} />;
                                          if (app === "gmail") return <Image src="/icons/gmail.png" alt="gmail" width={13} height={13} />;
                                          if (app === "calendar") return <Image src="/icons/calendar.png" alt="calendar" width={13} height={13} />;
                                          if (app === "drive") return <Image src="/icons/drive.png" alt="drive" width={13} height={13} />;
                                          return <Sparkle className="h-3 w-3" />;
                                        })()}
                                        <span className="truncate max-w-[220px]">{att.name || `${att.app} ${att.type || ''}`}</span>
                                      </span>
                                    ))}
                                  </AttachmentCarousel>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="h-7 w-7 ml-2 rounded bg-purple-500 flex-shrink-0 flex items-center justify-center">
                        <span className="text-sm font-medium text-white">
                          S
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3 w-full">
                    <div className="h-6 w-7 flex-shrink-0 flex items-start justify-center pt-1">
                      <Sparkle
                        size={20}
                        strokeWidth={1.5}
                        className={cn(
                          "text-gray-900 fill-current",
                          isLoading && index === visibleMessages.length - 1
                            ? "animate-spin-slow opacity-100"
                            : "opacity-100",
                        )}
                      />
                    </div>
                    <div
                      className={cn(
                        "text-sm leading-normal pt-1 max-w-[98%]",
                        message.content === "thinking..."
                          ? "shimmer-text"
                          : "text-gray-900",
                        isLoading && index === visibleMessages.length - 1
                          ? "opacity-100"
                          : "opacity-100",
                      )}
                    >
                      {message.structuredContent &&
                      message.structuredContent.length > 0 ? (
                        <div>
                          {message.structuredContent &&
                          message.structuredContent.length > 0 ? (
                            <>
                              {renderStructuredContent(
                                message.structuredContent,
                                handleApprove,
                                handleReject,
                                pendingHumanInput &&
                                  index === visibleMessages.length - 1
                                  ? { suppressPrompt: pendingHumanInput.prompt }
                                  : undefined,
                              )}
                              {pendingHumanInput &&
                                index === visibleMessages.length - 1 && (
                                  <div className="mt-2">
                                    <blockquote className="border-l-4 border-gray-300 pl-4 mb-2 italic text-gray-800">
                                      {pendingHumanInput.prompt}
                                    </blockquote>
                                    <div className="flex gap-2 items-center">
                                      <input
                                        className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white placeholder-gray-400 text-gray-700"
                                        value={humanInputValue}
                                        onChange={(e) =>
                                          setHumanInputValue(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (
                                            e.key === "Enter" &&
                                            !e.shiftKey &&
                                            humanInputValue.trim()
                                          ) {
                                            e.preventDefault();
                                            submitHumanInput(
                                              pendingHumanInput.threadId,
                                              pendingHumanInput.interruptId,
                                              humanInputValue,
                                            );
                                          }
                                        }}
                                        placeholder="Type your answer..."
                                        autoFocus
                                      />
                                      <button
                                        className="px-2.5 py-1 text-xs rounded bg-gray-900 text-white hover:bg-black disabled:opacity-50"
                                        disabled={!humanInputValue.trim()}
                                        onClick={() =>
                                          submitHumanInput(
                                            pendingHumanInput.threadId,
                                            pendingHumanInput.interruptId,
                                            humanInputValue,
                                          )
                                        }
                                      >
                                        Send
                                      </button>
                                    </div>
                                  </div>
                                )}
                              {/* Show sources at end of assistant turn even when structured content present */}
                              {message.role === "assistant" && (
                                <SourcesBar
                                  message={message as any}
                                  isStreaming={
                                    isLoading &&
                                    index === visibleMessages.length - 1
                                  }
                                />
                              )}
                            </>
                          ) : null}
                        </div>
                      ) : message.content === "thinking..." ? (
                        <span className="shimmer-text font-light text-black">
                          Thinking...
                        </span>
                      ) : (
                        <div>
                          {message.content &&
                          typeof message.content === "string" &&
                          message.content.trim() &&
                          message.content !== "[object Object]" &&
                          message.content !== "thinking..." ? (
                            (() => {
                              // Default markdown rendering
                              return (
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkBreaks]}
                                  components={{
                                    p: ({ children }) => (
                                      <p className="mt-0 mb-3 last:mb-0">{children}</p>
                                    ),
                                    ul: ({ children }) => (
                                      <ul className="pl-5 list-disc list-outside mb-3">{children}</ul>
                                    ),
                                    ol: ({ children }) => (
                                      <ol className="pl-5 list-decimal list-outside mb-3">{children}</ol>
                                    ),
                                    li: ({ children }) => (
                                      <li>{unwrapListItemChildren(children)}</li>
                                    ),
                                  }}
                                >
                                  {message.content}
                                </ReactMarkdown>
                              );
                            })()
                          ) : // Show tool calls if there's no content but there are tool calls
                          message.toolCalls && message.toolCalls.length > 0 ? (
                            <div className="space-y-2">
                              {message.toolCalls.map((toolCall, index) => (
                                <ToolCallComponent
                                  key={`fallback-tool-${toolCall.id || index}`}
                                  toolCall={toolCall}
                                  onApprove={handleApprove}
                                  onReject={handleReject}
                                />
                              ))}
                            </div>
                          ) : message.content === "thinking..." ? (
                            <span className="shimmer-text font-light text-black">
                              Thinking...
                            </span>
                          ) : null}
                          {message.role === "assistant" && (
                            <SourcesBar
                              message={message as any}
                              isStreaming={
                                isLoading &&
                                index === visibleMessages.length - 1
                              }
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            </div>
            </div>
            {/* Thinking animation when loading and no messages */}
            {isLoading && aiMessages.length === 0 && (
              <div className="flex gap-3 w-full">
                <div className="h-6 w-7 flex-shrink-0 flex items-start justify-center pt-1">
                  <Sparkle
                    size={20}
                    strokeWidth={1.5}
                    className="text-gray-900 fill-current"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="shimmer-text font-light text-black">
                    Thinking...
                  </span>
                </div>
              </div>
            )}
            {/* inline human_input panel is rendered above within the last assistant block */}
          </div>
        )}

        <div className={cn(visibleMessages.length > 0 ? "w-full" : "hidden")}>
          <div
            ref={composerRef}
            className="fixed bottom-8 left-[57.5%] -translate-x-1/2 z-40 w-[calc(100%-2.5rem)] max-w-2xl px-0 pt-3 pb-4 pl-3 bg-[#FCFBFA] shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.08)]"
          >
            {/* Fade out effect above composer */}
            <div className="absolute bottom-full left-0 right-0 h-16 bg-gradient-to-t from-[#FCFBFA] to-transparent pointer-events-none" />
            {/* Extend a blank backdrop under the fixed composer to the bottom of the page */}
            <div className="absolute -bottom-40 left-0 right-0 h-40 bg-[#FCFBFA] pointer-events-none" />
            <form onSubmit={handleSubmit} className="w-full relative pr-2">
              {error && (
                <div className="text-red-500 text-sm mb-2 p-2 bg-red-50 rounded">
                  {error}
                </div>
              )}
              <div className="relative">
                {(selectedPersona || references.length > 0) && (
                  <AttachmentCarousel className="absolute left-2 right-10 -top-7">
                    {selectedPersona && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[12px] border border-gray-200">
                        <User className="h-3.5 w-3.5" />
                        <span>Persona: {selectedPersona.name}</span>
                        <button type="button" className="ml-1 text-gray-500 hover:text-gray-800" onClick={() => setSelectedPersona(null)} aria-label="Remove persona">×</button>
                      </span>
                    )}
                    {references.map((ref, idx) => (
                      <span key={`${ref.app}-${ref.id}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[12px] border border-gray-200">
                        {ref.icon ? (
                          <Image src={ref.icon} alt={ref.app} width={14} height={14} />
                        ) : (
                          <Sparkle className="h-3.5 w-3.5" />
                        )}
                        <span>{ref.name || `${ref.app} item`}</span>
                        <button type="button" className="ml-1 text-gray-500 hover:text-gray-800" onClick={() => setReferences((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remove reference">×</button>
                      </span>
                    ))}
                  </AttachmentCarousel>
                )}
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={"Type @ to reference apps and more..."}
                  className="min-h-[44px] pl-4 pr-10 pt-2.5 resize-none border-gray-200 hover:border-gray-300 focus:!outline-none focus:!ring-0 focus:!ring-offset-0 focus:!ring-transparent focus:!border-gray-200 rounded-[5px] placeholder-gray-300"
                  rows={1}
                  onKeyDown={handleTextareaKeyDown}
                  onFocus={() => setSlashVisible(true)}
                  onBlur={resetSlashMenu}
                  disabled={isLoading || !!pendingApproval}
                />

                {isSlashOpen && (
                  <SlashCommandsMenu
                    items={menuItems}
                    selectedIndex={menuSelectedIndex}
                    onSelect={(item, index) => onMenuSelect(item as any, index)}
                    onHoverIndexChange={onMenuHoverIndexChange}
                  />
                )}

                <div className="absolute right-3 bottom-2.5">
                  {isLoading ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 -mt-2 mb-0.5 flex items-center justify-center rounded-sm bg-red-400 hover:bg-red-500 text-white text-xs"
                      onClick={() => cancelRequest()}
                    />
                  ) : (
                  <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 -m-1 flex items-center justify-center rounded-sm hover:bg-transparent"
                    disabled={!input.trim() || !!pendingApproval}
                    >
                      <CornerDownLeft className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex mt-2 space-x-2">
                <div>
                  <ModeSwitcher mode={mode} setMode={setMode} />
                </div>
                <div className="flex-1 flex justify-between">
                  <div className="flex gap-2">
                    <HumanInTheLoopDropdown />
                    <ParallelExecutionDropdown />
                  </div>
                  <button className="flex items-center pl-3 pr-1.5 h-8 text-[13.5px] font-normal text-gray-900 bg-gray-50 rounded-[5px] hover:bg-gray-100 focus:outline-none">
                    <div className="flex items-center">
                      <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
                      <span>Upload</span>
                    </div>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
        {/* Bottom sentinel to ensure scrolling truly reaches page bottom (below composer) */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

interface ModeSwitcherProps {
  mode: "act" | "talk";
  setMode: (mode: "act" | "talk") => void;
}

function HumanInTheLoopDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [level, setLevel] = useState("moderately");

  const getLevelIcon = () => {
    switch (level) {
      case "fully":
        return <Zap className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />;
      case "moderately":
        return <UserCheck className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />;
      case "highly":
        return <UserCog className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />;
      default:
        return <User className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />;
    }
  };

  const getLevelText = () => {
    switch (level) {
      case "fully":
        return "Fully Automated";
      case "moderately":
        return "Moderately Involved";
      case "highly":
        return "Highly Involved";
      default:
        return "Human in the Loop";
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center h-8 px-2.5 text-[13.5px] font-normal text-gray-900 bg-gray-50 rounded-[5px] hover:bg-gray-100 focus:outline-none">
          <div className="flex items-center whitespace-nowrap">
            {getLevelIcon()}
            <span className="ml-1 mr-2">{getLevelText()}</span>
            <ChevronDown
              className={`h-3 w-3 transform transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48 bg-gray-50 border border-gray-200 shadow-none rounded-[4px] py-1.5"
        align="end"
        sideOffset={2}
      >
        <DropdownMenuItem
          className="text-[12.5px] cursor-pointer px-2 py-1.5 rounded-[3px] focus:bg-gray-100"
          onClick={() => setLevel("fully")}
        >
          <Zap className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
          <span>Fully Automated</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[12.5px] cursor-pointer px-2 py-1.5 rounded-[3px] focus:bg-gray-100"
          onClick={() => setLevel("moderately")}
        >
          <UserCheck className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
          <span>Moderately Involved</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[12.5px] cursor-pointer px-2 py-1.5 rounded-[3px] focus:bg-gray-100"
          onClick={() => setLevel("highly")}
        >
          <UserCog className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
          <span>Highly Involved</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ParallelExecutionDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    isEnabled,
    maxConcurrency,
    toggleParallelExecutionLocal,
    setConcurrencyLocal,
    isLoading,
  } = useParallelExecutionConfig();

  const getStatusIcon = () => {
    if (isEnabled) {
      return (
        <Zap className="h-3.5 w-3.5 mr-1.5 text-blue-600" strokeWidth={1.75} />
      );
    }
    return (
      <Settings
        className="h-3.5 w-3.5 mr-1.5 text-gray-600"
        strokeWidth={1.75}
      />
    );
  };

  const getStatusText = () => {
    if (isEnabled) {
      return `Parallel (${maxConcurrency})`;
    }
    return "Sequential";
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center h-8 px-2.5 text-[13.5px] font-normal text-gray-900 bg-gray-50 rounded-[5px] hover:bg-gray-100 focus:outline-none">
          <div className="flex items-center whitespace-nowrap">
            {getStatusIcon()}
            <span className="ml-1 mr-0">{getStatusText()}</span>
            <ChevronDown
              className={`h-3 w-3 ml-2 transform transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56 bg-gray-50 border border-gray-200 shadow-none rounded-[4px] py-1.5"
        align="start"
        sideOffset={6}
      >
        <DropdownMenuItem
          className="text-[12.5px] cursor-pointer px-2 py-1.5 gap-1.5 rounded-[3px] focus:bg-gray-100"
          onClick={() => toggleParallelExecutionLocal(true)}
        >
          <Zap className="h-3.5 w-3.5 mr-2 text-blue-600" strokeWidth={1.75} />
          <div>
            <span className="font-medium">Enable Parallel</span>
            <div className="text-[11px] text-gray-500">
              Run safe tools simultaneously
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[12.5px] cursor-pointer px-2 py-1.5 gap-1.5 rounded-[3px] focus:bg-gray-100"
          onClick={() => toggleParallelExecutionLocal(false)}
        >
          <Settings
            className="h-3.5 w-3.5 mr-2 text-gray-600"
            strokeWidth={1.75}
          />
          <div>
            <span className="font-medium">Sequential Only</span>
            <div className="text-[11px] text-gray-500">
              Run all tools one by one
            </div>
          </div>
        </DropdownMenuItem>
        {isEnabled && (
          <>
            <div className="border-t border-gray-200 my-1"></div>
            <div className="px-3 py-2">
              <label className="text-[11px] text-gray-600 block mb-1">
                Max Concurrent Tools
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={maxConcurrency}
                  onChange={(e) =>
                    setConcurrencyLocal(parseInt(e.target.value) || 1)
                  }
                  className="w-12 h-6 px-1 text-[11px] border border-gray-300 rounded text-center"
                />
                <span className="text-[10px] text-gray-500">tools</span>
              </div>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModeSwitcher({ mode, setMode }: ModeSwitcherProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const gradientStyle = {
    background: "linear-gradient(90deg, #facc15, #ef4444, #ec4899, #3b82f6)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    textFillColor: "transparent",
    display: "inline-block",
  };

  const getIcon = (size = "base") => {
    const iconClass = size === "base" ? "h-4 w-4" : "h-3.5 w-3.5";
    const iconProps = {
      strokeWidth: 1.5,
      className: cn(iconClass, {
        "text-gray-900": mode !== "act",
      }),
    };

    switch (mode) {
      case "act":
        return <SquarePen {...iconProps} />;
      case "talk":
        return <MessageCircle {...iconProps} />;
      default:
        return null;
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center h-8 px-2 text-[13.5px] font-normal bg-gray-50 rounded-[5px] hover:bg-gray-100 focus:outline-none">
          <div className="flex items-center whitespace-nowrap gap-1.5">
            {getIcon()}
            <span
              className={cn("mr-1.5", {
                "font-medium": mode === "act",
              })}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </span>
            <ChevronDown
              className={cn("h-3 w-3 transform transition-transform", {
                "rotate-180": isOpen,
              })}
            />
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-22 bg-gray-50 border border-gray-200 shadow-none rounded-[4px] pt-1"
        align="start"
        sideOffset={4}
      >
        {mode === "talk" ? (
          <DropdownMenuItem
            className="text-[12.5px] cursor-pointer px-2 py-1 rounded-[3px] focus:bg-gray-100"
            onClick={() => setMode("act")}
          >
            <SquarePen className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
            <span>Act</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-[12.5px] cursor-pointer px-2 py-1 rounded-[3px] focus:bg-gray-100"
            onClick={() => setMode("talk")}
          >
            <MessageCircle
              className="h-3.5 w-3.5 mr-2 text-gray-900"
              strokeWidth={1.5}
            />
            <span className="text-gray-900">Talk</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SlashCommandsMenu({
  items,
  selectedIndex,
  onSelect,
  onHoverIndexChange,
}: {
  items: Array<{
    id: string;
    title: string;
    description?: string;
    icon?: React.ReactNode;
  }>;
  selectedIndex: number;
  onSelect: (item: any, index: number) => void;
  onHoverIndexChange?: (index: number) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 mb-2 w-[min(380px,85%)]">
      <div>
        <div className="bg-[#F4F3ED] border border-gray-300 rounded-[8px] p-1.5 animate-[bubble-in_140ms_ease-out] overflow-y-auto" style={{ maxHeight: 260 }}>
          <style jsx>{`
            @keyframes bubble-in {
              from { opacity: 0; transform: translateY(6px) scale(0.98); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes bubble-out {
              from { opacity: 1; transform: translateY(0) scale(1); }
              to { opacity: 0; transform: translateY(6px) scale(0.98); }
            }
          `}</style>
          <div className="grid grid-cols-1 gap-1 no-scrollbar">
            {items.length === 0 ? (
              <div className="text-[12px] text-gray-500 px-2 py-2">No commands</div>
            ) : (
              items.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-[6px] border border-transparent transition-colors duration-200 ease-out focus-visible:outline-none",
                    idx === selectedIndex ? "border-gray-300 font-medium" : "hover:border-gray-300"
                  )}
                  onMouseEnter={() => onHoverIndexChange && onHoverIndexChange(idx)}
                  onClick={() => onSelect(item, idx)}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex-shrink-0">{item.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-gray-900 truncate">{item.title}</div>
                      {item.description && (
                        <div className="text-[11.5px] text-gray-600 truncate">{item.description}</div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
