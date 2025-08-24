import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tokenRefreshManager } from "@/lib/token-refresh";
import { mcpManager } from "@/lib/mcp-manager";

export async function GET(request: NextRequest) {
  try {
    console.log("🔍 Token status check API called");

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    // Check user connection status
    const connectionStatus = await tokenRefreshManager.checkUserConnectionStatus(
      user.id
    );

    return NextResponse.json({
      success: true,
      userId: user.id,
      connectionStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error checking token status:", error);
    return NextResponse.json(
      {
        error: "Failed to check token status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("🔄 Token refresh API called");

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    const { force = false } = await request.json().catch(() => ({}));

    console.log(`🔄 Refreshing tokens for user: ${user.id} (force: ${force})`);

    // Ensure all tokens are fresh
    const refreshResult = await tokenRefreshManager.ensureAllTokensFresh(
      user.id
    );

    // If tokens were refreshed, clear MCP cache
    if (refreshResult.refreshedApps.length > 0) {
      console.log("🗑️ Clearing MCP cache due to token refresh...");
      mcpManager.clearUserCache(user.id);
    }

    // Get updated connection status
    const connectionStatus = await tokenRefreshManager.checkUserConnectionStatus(
      user.id
    );

    return NextResponse.json({
      success: refreshResult.success,
      userId: user.id,
      refreshedApps: refreshResult.refreshedApps,
      failedApps: refreshResult.failedApps,
      connectionStatus,
      cacheCleared: refreshResult.refreshedApps.length > 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error refreshing tokens:", error);
    return NextResponse.json(
      {
        error: "Failed to refresh tokens",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
