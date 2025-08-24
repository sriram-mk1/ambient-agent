import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { zepManager } from "@/lib/zep-manager";

export async function GET(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") || 50);
    const limit = Math.min(Math.max(limitParam, 1), 50);

    const results = await zepManager.searchMemory(user.id, "*", limit, "nodes");
    const nodes = (results?.nodes || []).filter((n: any) => !!n);

    const items = nodes.map((n: any) => ({
      id: String(n.id || n.nodeId || n.uuid || n.name || "node"),
      type: String(n.type || n.kind || "entity"),
      name: String(n.name || n.title || n.id || "node"),
      summary: n.summary || n.description || null,
      createdAt: n.createdAt || n.metadata?.createdAt || null,
      metadata: n.metadata || {},
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error("/api/memory-manager GET", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await req.json();
    const { text, metadata } = body || {};
    const ok = await zepManager.addUserData(user.id, text || JSON.stringify(metadata || {}), text ? "text" : "json");
    if (!ok) return NextResponse.json({ error: "update_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("/api/memory-manager PATCH", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return NextResponse.json({ ok: false, message: "Delete not implemented" }, { status: 501 });
  } catch (err) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
