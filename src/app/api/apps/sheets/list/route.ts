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
    const pageSize = Math.min(parseInt(url.searchParams.get("pageSize") || "20"), 50);

    // Acquire a fresh token for Sheets/Drive
    let accessToken: string | null = null;
    try {
      const { tokenRefreshManager } = await import("@/lib/token-refresh");
      accessToken =
        (await tokenRefreshManager.getFreshToken(user.id, "sheets")) ||
        (await tokenRefreshManager.getFreshToken(user.id, "drive")) ||
        null;
    } catch {}

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing Google access token for Sheets/Drive" },
        { status: 400 },
      );
    }

    // Query Google Drive for spreadsheets
    const driveQueryParts = [
      "mimeType='application/vnd.google-apps.spreadsheet'",
      "trashed=false",
    ];
    if (query) {
      const safe = query.replace(/["\\]/g, "\\$&");
      driveQueryParts.push(`name contains '${safe}'`);
    }
    const driveQ = driveQueryParts.join(" and ");

    const params = new URLSearchParams({
      q: driveQ,
      fields: "files(id,name,modifiedTime,owners,iconLink,mimeType)",
      pageSize: String(pageSize),
      orderBy: "modifiedTime desc",
      spaces: "drive",
    });

    const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}` , {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: "Drive API error", details: text }, { status: 502 });
    }

    const data: any = await resp.json();
    const files = Array.isArray(data.files) ? data.files : [];

    return NextResponse.json({
      items: files.map((f: any) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        owner: f.owners?.[0]?.displayName || null,
        mimeType: f.mimeType,
        icon: "/icons/sheets.png",
      })),
    });
  } catch (error) {
    console.error("/api/apps/sheets/list error", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
