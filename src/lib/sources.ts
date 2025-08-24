export type SourceItem = {
  id: string;
  type: "web" | "doc" | "sheet" | "mail" | "other";
  title?: string;
  url?: string;
  label?: string; // domain/descriptor
  iconKey: "web" | "doc" | "sheet" | "gmail" | "other";
  favicon?: string; // optional favicon for web sources
};

function buildGmailUrl(id?: string): string | undefined {
  if (!id) return undefined;
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

function buildDocUrl(id?: string): string | undefined {
  if (!id) return undefined;
  return `https://docs.google.com/document/d/${id}/edit`;
}

function buildSheetUrl(id?: string): string | undefined {
  if (!id) return undefined;
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export function extractSourcesFromTool(
  toolName: string,
  args: any,
  result: any,
): SourceItem[] {
  const byUrl = new Map<string, SourceItem>();
  const normalizeUrl = (u?: string): string | undefined => {
    if (!u || typeof u !== "string") return undefined;
    try {
      const url = new URL(u);
      const hostLower = url.hostname.toLowerCase();
      const pathLower = url.pathname.toLowerCase();
      // Gmail: keep hash (message id), drop queries
      if (/mail\.google\.com$/i.test(hostLower)) {
        url.search = "";
      } else {
        // Google Docs/Sheets: drop all query params to avoid duplicates (usp, resourcekey, authuser, etc.)
        if (/docs\.google\.com$/i.test(hostLower) && (/\/document\//.test(pathLower) || /\/spreadsheets\//.test(pathLower))) {
          url.search = "";
        } else {
          // Generic: sort query params and remove utm_*
          if (url.searchParams && url.searchParams.size > 0) {
            const keys = Array.from(url.searchParams.keys());
            const kept: Array<[string, string]> = [];
            for (const k of keys) {
              if (/^utm_/i.test(k)) continue;
              const vals = url.searchParams.getAll(k);
              for (const v of vals) kept.push([k, v]);
            }
            url.search = "";
            kept.sort(([a], [b]) => a.localeCompare(b));
            for (const [k, v] of kept) url.searchParams.append(k, v);
          }
          // Never need hash outside Gmail
          url.hash = "";
        }
      }
      const host = hostLower;
      url.hostname = host;
      const normalized = url.toString().replace(/\/$/, "");
      return normalized;
    } catch {
      return u;
    }
  };
  const hasRequired = (s?: SourceItem): s is SourceItem => {
    return !!(
      s && s.url && s.title && s.label && s.iconKey && s.type
    );
  };
  const n = (toolName || "").toLowerCase();
  const a = args || {};
  const r = normalizeResult(result);

  try {
    // High-signal debug of inputs
    // Note: keep payload sizes small; only log top-level keys
    const argsKeys = a && typeof a === "object" ? Object.keys(a) : [];
    const resultInfo =
      r && typeof r === "object"
        ? { type: typeof r, keys: Object.keys(r).slice(0, 10) }
        : { type: typeof r };
    console.log("[Sources] extractSourcesFromTool", {
      toolName,
      argsKeys,
      resultInfo,
    });
  } catch {}

  const push = (s: SourceItem | undefined) => {
    if (!hasRequired(s)) return;
    const nu = normalizeUrl(s.url);
    if (!nu) return;
    const incoming: SourceItem = { ...s, id: nu, url: nu };
    const existing = byUrl.get(nu);
    if (!existing) {
      byUrl.set(nu, incoming);
      return;
    }
    // Upgrade logic: prefer non-web types and better titles/labels/icon
    const rank = (t: string) => (t === "mail" ? 3 : t === "doc" ? 2 : t === "sheet" ? 2 : t === "web" ? 1 : 0);
    const existingRank = rank(existing.type);
    const incomingRank = rank(incoming.type);
    let winner: SourceItem = existing;
    if (incomingRank > existingRank) winner = incoming;
    // Prefer non-URL titles over URL-looking titles
    const looksLikeUrl = (v?: string) => !!v && /^https?:\/\//i.test(v);
    if (!looksLikeUrl(incoming.title) && looksLikeUrl(existing.title)) winner = { ...winner, title: incoming.title } as SourceItem;
    // Prefer specific iconKey over web
    if (existing.iconKey === "web" && incoming.iconKey !== "web") winner = { ...winner, iconKey: incoming.iconKey } as SourceItem;
    // Prefer label if missing
    if (!existing.label && incoming.label) winner = { ...winner, label: incoming.label } as SourceItem;
    // Preserve favicon if present
    if (!winner.favicon && incoming.favicon) winner = { ...winner, favicon: incoming.favicon } as SourceItem;
    byUrl.set(nu, winner);
  };

  const getEmailSubject = (item: any): string | undefined => {
    if (!item) return undefined;
    if (typeof item.subject === "string" && item.subject.trim()) return item.subject.trim();
    if (typeof item.snippet === "string" && item.snippet.trim()) return item.snippet.trim().slice(0, 140);
    if (item.headers && typeof item.headers.subject === "string") return item.headers.subject;
    const headersArr = item.payload?.headers || item.headers;
    if (Array.isArray(headersArr)) {
      const subj = headersArr.find((h: any) => (h?.name || "").toLowerCase() === "subject");
      if (subj && typeof subj.value === "string" && subj.value.trim()) return subj.value.trim();
    }
    return undefined;
  };

  // Gmail family
  if (
    n.includes("gmail") ||
    n.includes("email") ||
    n.includes("getemail") ||
    n.includes("listemails") ||
    n.includes("markemail") ||
    n.includes("movemail")
  ) {
    console.log("[Sources] Gmail family detected for", toolName);
    const id =
      (r as any)?.id ||
      (r as any)?.messageId ||
      (r as any)?.message_id ||
      (r as any)?.threadId ||
      (r as any)?.thread_id ||
      a.id ||
      a.messageId ||
      a.message_id ||
      a.threadId ||
      a.thread_id;
    const url = buildGmailUrl(String(id || ""));
    if (url) {
      push({
        id: url,
        type: "mail",
        title: getEmailSubject(r) || a.subject || "Email",
        url,
        label: "gmail.com",
        iconKey: "gmail",
      });
    }

    // If a list call returns multiple emails (support many shapes)
    const emailArrays: any[] = gatherArrays(r, [
      "items",
      "messages",
      "threads",
      "emails",
      "results",
      "data",
      "list",
    ]);
    for (const arr of emailArrays) {
      if (Array.isArray(arr)) {
        console.log("[Sources] Gmail list array size", arr.length);
      }
      for (const item of arr) {
        const emailId = item?.id || item?.messageId || item?.message_id || item?.threadId || item?.thread_id;
        const itemUrl = buildGmailUrl(String(emailId || ""));
        if (itemUrl) {
          const subject = getEmailSubject(item) || "Email";
          push({
            id: itemUrl,
            type: "mail",
            title: subject,
            url: itemUrl,
            label: "gmail.com",
            iconKey: "gmail",
          });
        }
      }
    }

    // Deep scan for embedded arrays of emails (useful for parallel outputs or nested wrappers)
    const emailArraysDeep: any[] = gatherCandidateArraysDeep(r);
    for (const arr of emailArraysDeep) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const looksLikeMail = !!(
          item.subject || item.messageId || item.message_id || item.threadId || item.thread_id
        );
        if (!looksLikeMail) continue;
        const emailId = item.messageId || item.message_id || item.id || item.threadId || item.thread_id;
        const itemUrl = buildGmailUrl(String(emailId || ""));
        if (!itemUrl) continue;
        const subject = getEmailSubject(item) || "Email";
        push({
          id: itemUrl,
          type: "mail",
          title: subject,
          url: itemUrl,
          label: "gmail.com",
          iconKey: "gmail",
        });
      }
    }

    // If nothing was discovered from result payloads, still surface Gmail app source
    if (byUrl.size === 0) {
      const inboxUrl = "https://mail.google.com/mail/u/0/#inbox";
      push({
        id: inboxUrl,
        type: "mail",
        title: a?.subject || "Gmail",
        url: inboxUrl,
        label: "gmail.com",
        iconKey: "gmail",
      });
    }
    return Array.from(byUrl.values());
  }

  // Google Docs family
  if (
    n.includes("doc") ||
    n.includes("document") ||
    n.includes("inserttext") ||
    n.includes("createdocument") ||
    n.includes("updatedocument") ||
    n.includes("getdocument") ||
    n.includes("listdocuments")
  ) {
    console.log("[Sources] Docs family detected for", toolName);
    const docId = (r as any)?.documentId || (r as any)?.id || a.documentId || a.id;
    const url = buildDocUrl(String(docId || ""));
    if (url) {
      push({
        id: url,
        type: "doc",
        title: (r as any)?.title || a.title || a.name || "Google Doc",
        url,
        label: "docs.google.com",
        iconKey: "doc",
      });
    }

    const docArraysShallow: any[] = gatherArrays(r, [
      "items",
      "documents",
      "docs",
      "files",
      "results",
      "list",
      "data",
    ]);
    const docArraysDeep: any[] = gatherCandidateArraysDeep(r);
    const docArrays: any[] = [...docArraysShallow, ...docArraysDeep];
    for (const arr of docArrays) {
      if (Array.isArray(arr)) {
        console.log("[Sources] Docs list array size", arr.length);
        console.log(
          "[Sources] Docs sample items",
          arr.slice(0, 3).map((it: any) => ({ id: it?.id, name: it?.name, webViewLink: it?.webViewLink }))
        );
      }
      for (const item of arr) {
        const id = item?.documentId || item?.id;
        const itemUrl = item?.webViewLink || buildDocUrl(String(id || ""));
        if (itemUrl) {
          push({
            id: itemUrl,
            type: "doc",
            title: item?.title || item?.name || "Google Doc",
            url: itemUrl,
            label: "docs.google.com",
            iconKey: "doc",
          });
        }
      }
    }
    return Array.from(byUrl.values());
  }

  // Google Sheets family
  if (
    n.includes("sheet") ||
    n.includes("spreadsheet") ||
    n.includes("getvalues") ||
    n.includes("appendvalues") ||
    n.includes("updatevalues") ||
    n.includes("createspreadsheet") ||
    n.includes("listspreadsheets")
  ) {
    console.log("[Sources] Sheets family detected for", toolName);
    const sheetId = (r as any)?.spreadsheetId || (r as any)?.id || a.spreadsheetId || a.id;
    const url = buildSheetUrl(String(sheetId || ""));
    if (url) {
      push({
        id: url,
        type: "sheet",
        title: (r as any)?.title || a.title || a.name || "Google Sheet",
        url,
        label: "docs.google.com",
        iconKey: "sheet",
      });
    }

    const sheetArrays: any[] = gatherArrays(r, [
      "items",
      "spreadsheets",
      "sheets",
      "files",
      "results",
      "list",
    ]);
    for (const arr of sheetArrays) {
      if (Array.isArray(arr)) {
        console.log("[Sources] Sheets list array size", arr.length);
      }
      for (const item of arr) {
        const id = item?.spreadsheetId || item?.id;
        const itemUrl = buildSheetUrl(String(id || ""));
        if (itemUrl) {
          push({
            id: itemUrl,
            type: "sheet",
            title: item?.title || item?.name || "Google Sheet",
            url: itemUrl,
            label: "docs.google.com",
            iconKey: "sheet",
          });
        }
      }
    }
    return Array.from(byUrl.values());
  }

  // fast_web_search and exa web_search variants structured results
  if (
    n.includes("fast_web_search") ||
    n.includes("web_search_exa") ||
    n.includes("company_research_exa") ||
    n.includes("linkedin_search_exa") ||
    n.includes("social_discussion_search_exa") ||
    n.includes("crawling_exa")
  ) {
    console.log("[Sources] exa web tool detected for", toolName);
    const results = r.results || r.items || r.data || [];
    if (Array.isArray(results)) {
      console.log("[Sources] exa results size", results.length);
      for (const item of results) {
        const url = item?.url || item?.link || item?.id;
        if (typeof url === "string" && url.startsWith("http")) {
          push({
            id: url,
            type: "web",
            title: item?.title || url,
            url,
            label: (() => {
              try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
            })(),
            iconKey: "web",
            favicon: typeof item?.favicon === "string" ? item.favicon : undefined,
          });
        }
      }
    }
    return Array.from(byUrl.values());
  }

  // Generic URL discovery
  // Generic URL discovery in structured result
  const candidateUrl = (r as any)?.url || (r as any)?.link || a.url || a.link;
  if (typeof candidateUrl === "string" && candidateUrl.startsWith("http")) {
    let host = "";
    let path = "";
    try {
      const u = new URL(candidateUrl);
      host = u.hostname.replace(/^www\./, "");
      path = u.pathname || "";
    } catch {}

    if (/mail\.google\.com$/i.test(host)) {
      push({
        id: candidateUrl,
        type: "mail",
        title: (r as any)?.subject || (r as any)?.title || a.subject || "Email",
        url: candidateUrl,
        label: "gmail.com",
        iconKey: "gmail",
      });
    } else if (/docs\.google\.com$/i.test(host)) {
      if (/\/document\//i.test(path)) {
        push({ id: candidateUrl, type: "doc", title: (r as any)?.title || a.title || "Google Doc", url: candidateUrl, label: "docs.google.com", iconKey: "doc" });
      } else if (/\/spreadsheets\//i.test(path)) {
        push({ id: candidateUrl, type: "sheet", title: (r as any)?.title || a.title || "Google Sheet", url: candidateUrl, label: "docs.google.com", iconKey: "sheet" });
      } else {
        push({ id: candidateUrl, type: "web", title: (r as any)?.title || a.title || candidateUrl, url: candidateUrl, label: host, iconKey: "web" });
      }
    } else {
      push({
        id: candidateUrl,
        type: "web",
        title: (r as any)?.title || a.title || candidateUrl,
        url: candidateUrl,
        label: host,
        iconKey: "web",
      });
    }
    console.log("[Sources] generic URL discovered", candidateUrl);
  }

  // Fallback: result is string and may contain URLs from tool output (still tool output, not AI text)
  if (typeof result === "string") {
    const urls = (result.match(/https?:\/\/[^\s)]+/g) || []) as string[];
    const uniq = Array.from(new Set(urls));
    if (uniq.length) console.log("[Sources] URLs found in string result", uniq.length);
    for (const url of uniq) {
      if (!url.startsWith("http")) continue;
      let host = "";
      let path = "";
      try { const u = new URL(url); host = u.hostname.replace(/^www\./, ""); path = u.pathname || ""; } catch {}
      if (/mail\.google\.com$/i.test(host)) {
        push({ id: url, type: "mail", title: "Email", url, label: "gmail.com", iconKey: "gmail" });
      } else if (/docs\.google\.com$/i.test(host)) {
        if (/\/document\//i.test(path)) {
          push({ id: url, type: "doc", title: url, url, label: "docs.google.com", iconKey: "doc" });
        } else if (/\/spreadsheets\//i.test(path)) {
          push({ id: url, type: "sheet", title: url, url, label: "docs.google.com", iconKey: "sheet" });
        } else {
          push({ id: url, type: "web", title: url, url, label: host, iconKey: "web" });
        }
      } else {
        push({ id: url, type: "web", title: url, url, label: host, iconKey: "web" });
      }
    }
  }

  // Special handling: parallel executor often returns a combined markdown string.
  // Try to extract embedded JSON fragments for emails/docs/sheets, and also
  // parse the <parallel_results>{...}</parallel_results> block if present.
  if (
    (n.includes("parallel_tool_executor") || n.includes("parallel")) &&
    typeof result === "string"
  ) {
    try {
      const str = result;
      const fragments: any[] = [];
      // Extract structured parallel results block for high-fidelity parsing
      const prMatch = str.match(/<parallel_results>([\s\S]*?)<\/parallel_results>/);
      if (prMatch && prMatch[1]) {
        try {
          const parsed = JSON.parse(prMatch[1]);
          // Expect shape { results: [ { toolName, result } ] }
          const prResults = Array.isArray(parsed?.results) ? parsed.results : [];
          for (const entry of prResults) {
            if (!entry) continue;
            const entryToolName = String(entry.toolName || "");
            const entryResult = entry.result;

            // First, try direct extraction by delegating to this function for the specific tool name
            try {
              const subSources = extractSourcesFromTool(entryToolName, {}, entryResult);
              if (Array.isArray(subSources) && subSources.length > 0) {
                for (const s of subSources) push(s);
              }
            } catch {}

            // Also collect fragment for deep scan
            if (entryResult) {
              // Normalize strings into JSON if possible
              const normalized = typeof entryResult === "string" ? normalizeResult(entryResult) : entryResult;
              fragments.push(normalized);
            }
          }
        } catch {}
      }
      // Extract JSON arrays and objects naively; ignore parse failures
      const arrayMatches = str.match(/\[[\s\S]*?\]/g) || [];
      const objectMatches = str.match(/\{[\s\S]*?\}/g) || [];
      for (const m of [...arrayMatches, ...objectMatches]) {
        try {
          const parsed = JSON.parse(m);
          fragments.push(parsed);
        } catch {}
      }

      for (const frag of fragments) {
        const deepArrays = gatherCandidateArraysDeep(frag);
        for (const arr of deepArrays) {
          if (!Array.isArray(arr)) continue;
          for (const item of arr) {
            if (!item || typeof item !== "object") continue;

            const isSheet = !!(item.spreadsheetId || (item.mimeType && /sheet/i.test(item.mimeType)));
            const isDoc = !!(item.documentId || (item.mimeType && /(document|doc)/i.test(item.mimeType)));
            const isMail = !!(item.subject || item.messageId || item.threadId);

            if (isMail) {
              const emailId = item.messageId || item.id || item.threadId;
              const url = buildGmailUrl(String(emailId || ""));
              if (url) {
                push({ id: url, type: "mail", title: item.subject || "Email", url, label: "gmail.com", iconKey: "gmail" });
              }
              continue;
            }

            if (isDoc) {
              const id = item.documentId || item.id;
            const url = item.webViewLink || buildDocUrl(String(id || ""));
              if (url) {
              const title = item.title || item.name || (typeof item.fileName === "string" ? item.fileName : undefined) || "Google Doc";
              push({ id: url, type: "doc", title, url, label: "docs.google.com", iconKey: "doc" });
              }
              continue;
            }

            if (isSheet) {
              const id = item.spreadsheetId || item.id;
            const url = item.webViewLink || buildSheetUrl(String(id || ""));
              if (url) {
              const title = item.title || item.name || (typeof item.fileName === "string" ? item.fileName : undefined) || "Google Sheet";
              push({ id: url, type: "sheet", title, url, label: "docs.google.com", iconKey: "sheet" });
              }
              continue;
            }

            const url: string | undefined = (item as any).url || (item as any).link || (item as any).webViewLink;
            if (typeof url === "string" && url.startsWith("http")) {
              push({
                id: url,
                type: "web",
                title: (item as any).title || (item as any).name || url,
                url,
                label: (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
                iconKey: "web",
                favicon: typeof (item as any).favicon === "string" ? (item as any).favicon : undefined,
              });
            }
          }
        }
      }
    } catch (e) {
      console.log("[Sources] Parallel JSON fragment extraction failed:", e);
    }
  }

  // Generic deep extraction for parallel or unknown tool outputs
  // Especially useful when results come from parallel_tool_executor
  if (
    byUrl.size === 0 ||
    n.includes("parallel_tool_executor") ||
    n.includes("parallel")
  ) {
    try {
      const deepArrays = gatherCandidateArraysDeep(r);
      for (const arr of deepArrays) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;

          // Heuristic type detection
          const isSheet = !!(item.spreadsheetId || (item.mimeType && /sheet/i.test(item.mimeType)));
          const isDoc = !!(item.documentId || (item.mimeType && /(document|doc)/i.test(item.mimeType)));
          const isMail = !!(item.subject || item.messageId || item.threadId);

          if (isMail) {
            const emailId = item.messageId || item.id || item.threadId;
            const url = buildGmailUrl(String(emailId || ""));
            if (url) {
              push({
                id: url,
                type: "mail",
                title: item.subject || "Email",
                url,
                label: "gmail.com",
                iconKey: "gmail",
              });
            }
            continue;
          }

          if (isDoc) {
            const id = item.documentId || item.id;
            const url = item.webViewLink || buildDocUrl(String(id || ""));
            if (url) {
              push({
                id: url,
                type: "doc",
                title: item.title || item.name || "Google Doc",
                url,
                label: "docs.google.com",
                iconKey: "doc",
              });
            }
            continue;
          }

          if (isSheet) {
            const id = item.spreadsheetId || item.id;
            const url = item.webViewLink || buildSheetUrl(String(id || ""));
            if (url) {
              push({
                id: url,
                type: "sheet",
                title: item.title || item.name || "Google Sheet",
                url,
                label: "docs.google.com",
                iconKey: "sheet",
              });
            }
            continue;
          }

          // Fallback: generic web item if a URL exists on the object
          const url: string | undefined = item.url || item.link || item.webViewLink;
          if (typeof url === "string" && url.startsWith("http")) {
            let host = "";
            let path = "";
            try { const u = new URL(url); host = u.hostname.replace(/^www\./, ""); path = u.pathname || ""; } catch {}
            if (/mail\.google\.com$/i.test(host)) {
              push({ id: url, type: "mail", title: item.title || item.subject || "Email", url, label: "gmail.com", iconKey: "gmail" });
            } else if (/docs\.google\.com$/i.test(host)) {
              if (/\/document\//i.test(path)) {
                push({ id: url, type: "doc", title: item.title || item.name || "Google Doc", url, label: "docs.google.com", iconKey: "doc" });
              } else if (/\/spreadsheets\//i.test(path)) {
                push({ id: url, type: "sheet", title: item.title || item.name || "Google Sheet", url, label: "docs.google.com", iconKey: "sheet" });
              } else {
                push({ id: url, type: "web", title: item.title || item.name || url, url, label: host, iconKey: "web", favicon: typeof (item as any).favicon === "string" ? (item as any).favicon : undefined });
              }
            } else {
              push({ id: url, type: "web", title: item.title || item.name || url, url, label: host, iconKey: "web", favicon: typeof (item as any).favicon === "string" ? (item as any).favicon : undefined });
            }
          }
        }
      }
    } catch (e) {
      console.log("[Sources] Generic deep extraction failed:", e);
    }
  }

  try {
    const finalSources = Array.from(byUrl.values());
    console.log("[Sources] extractSourcesFromTool -> total", finalSources.length);
    if (finalSources.length) {
      console.log(
        "[Sources] URLs:",
        finalSources.map((s) => s.url).filter(Boolean).slice(0, 10),
      );
    }
    return finalSources;
  } catch {
    return Array.from(byUrl.values());
  }
}

// Helpers
function normalizeResult(result: any): any {
  if (result == null) return {};
  if (typeof result === "string") {
    let s = result.trim();
    // Strip code fences like ```json ... ```
    const fenceMatch = s.match(/^```[a-zA-Z]*\n([\s\S]*?)```\s*$/);
    if (fenceMatch) {
      s = fenceMatch[1];
    }
    // Try direct parse
    try {
      return JSON.parse(s);
    } catch {}
    // Try to extract a JSON array
    try {
      const startArr = s.indexOf("[");
      const endArr = s.lastIndexOf("]");
      if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
        return JSON.parse(s.slice(startArr, endArr + 1));
      }
    } catch {}
    // Try to extract a JSON object
    try {
      const startObj = s.indexOf("{");
      const endObj = s.lastIndexOf("}");
      if (startObj !== -1 && endObj !== -1 && endObj > startObj) {
        return JSON.parse(s.slice(startObj, endObj + 1));
      }
    } catch {}
    return {};
  }
  return result;
}

function gatherArrays(obj: any, keys: string[]): any[] {
  const arrays: any[] = [];
  if (!obj || typeof obj !== "object") return arrays;
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) arrays.push(v);
  }
  // If the whole object is an array
  if (Array.isArray(obj)) arrays.push(obj);
  return arrays;
}

// Deeply scan for arrays of objects that look like items (documents/emails/sheets)
function gatherCandidateArraysDeep(
  obj: any,
  maxDepth: number = 4,
  visited = new Set<any>(),
): any[] {
  const results: any[] = [];
  if (!obj || typeof obj !== "object" || maxDepth < 0 || visited.has(obj)) {
    return results;
  }
  visited.add(obj);

  // If obj itself is an array, and looks like array of objects with id-like fields
  if (Array.isArray(obj)) {
    const first = obj[0];
    if (first && typeof first === "object") {
      const keys = Object.keys(first);
      const hasIdLike = [
        "id",
        "documentId",
        "spreadsheetId",
        "messageId",
        "threadId",
        "url",
        "subject",
      ].some((k) => keys.includes(k));
      if (hasIdLike) {
        results.push(obj);
      }
    }
    // Also scan elements
    for (const el of obj) {
      results.push(...gatherCandidateArraysDeep(el, maxDepth - 1, visited));
    }
    return results;
  }

  // For objects, scan all properties
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      const first = val[0];
      if (first && typeof first === "object") {
        const keys = Object.keys(first);
        const hasIdLike = [
          "id",
          "documentId",
          "spreadsheetId",
          "messageId",
          "threadId",
          "url",
          "subject",
        ].some((k) => keys.includes(k));
        if (hasIdLike) {
          results.push(val);
        }
      }
    } else if (val && typeof val === "object") {
      results.push(...gatherCandidateArraysDeep(val, maxDepth - 1, visited));
    }
  }

  return results;
}
