import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mcpManager } from "@/lib/mcp-manager";

export async function POST(request: Request) {
  try {
    console.log("🔄 [DEBUG] MCP cache refresh endpoint called");

    const supabase = await createClient();

    // Get the authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("❌ [DEBUG] Auth error in cache refresh:", userError);
      return NextResponse.json(
        { error: "Authentication failed", details: userError.message },
        { status: 401 },
      );
    }

    if (!user) {
      console.error("❌ [DEBUG] No user found in cache refresh");
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      );
    }

    console.log("✅ [DEBUG] User authenticated:", user.id);
    console.log("🔄 [DEBUG] Force rebuilding MCP cache...");

    // Force rebuild the MCP cache
    const result = await mcpManager.forceRebuildUserCache(user.id);

    if (result) {
      console.log("✅ [DEBUG] MCP cache rebuild successful");

      // Get cache stats for debugging
      const cacheStats = mcpManager.getCacheStats();

      return NextResponse.json({
        success: true,
        message: "MCP cache rebuilt successfully",
        toolCount: result.tools?.length || 0,
        hasAgent: false, // Agent creation moved to agent library
        cacheStats,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error("❌ [DEBUG] MCP cache rebuild failed");
      return NextResponse.json(
        {
          error: "Failed to rebuild MCP cache",
          message: "Cache rebuild returned null result",
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("❌ [DEBUG] Unexpected error in cache refresh:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
