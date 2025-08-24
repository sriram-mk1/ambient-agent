import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").toString();
    const maxResults = Math.min(parseInt(url.searchParams.get("maxResults") || "20"), 50);

    // Acquire a fresh token for Gmail
    let accessToken: string | null = null;
    try {
      const { tokenRefreshManager } = await import("@/lib/token-refresh");
      accessToken = await tokenRefreshManager.getFreshToken(user.id, "gmail");
    } catch {}

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing Google access token for Gmail" },
        { status: 400 },
      );
    }

    // Gmail list messages (simple: list and fetch metadata)
    const listParams = new URLSearchParams({
      maxResults: String(maxResults),
      q: query || "",
    });

    const listResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!listResp.ok) {
      const text = await listResp.text();
      return NextResponse.json({ error: "Gmail API error", details: text }, { status: 502 });
    }

    const listData: any = await listResp.json();
    const messages: any[] = Array.isArray(listData.messages) ? listData.messages : [];

    // Fetch details for first N messages
    const detailPromises = messages.slice(0, maxResults).map(async (m) => {
      try {
        const detResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!detResp.ok) return null;
        const det: any = await detResp.json();
        const headers: any[] = det.payload?.headers || [];
        const getHeader = (n: string) => headers.find((h) => h?.name?.toLowerCase() === n.toLowerCase())?.value || null;
        return {
          id: det.id,
          snippet: det.snippet || null,
          subject: getHeader('subject') || det.snippet || det.id,
          from: getHeader('from') || null,
        };
      } catch {
        return null;
      }
    });

    const details = (await Promise.all(detailPromises)).filter(Boolean);

    return NextResponse.json({ items: details });
  } catch (error) {
    console.error("/api/apps/gmail/list error", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
