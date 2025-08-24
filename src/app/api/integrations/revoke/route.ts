import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mcpManager } from "@/lib/mcp-manager";
import { agentManager } from "@/lib/agent";

interface RevokeRequest {
  app: string;
}

export async function POST(request: Request) {
  try {
    console.log("🔄 Revoke integration API called");

    // Parse request body
    let body: RevokeRequest;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error("❌ Failed to parse request body:", parseError);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const { app } = body;

    if (!app) {
      console.error("❌ App name is required");
      return NextResponse.json(
        { error: "App name is required" },
        { status: 400 },
      );
    }

    console.log(`🔄 Revoking access for app: ${app}`);

    const supabase = await createClient();

    // Get the authenticated user with better error handling
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("❌ Auth error in revoke integration API:", userError);
      return NextResponse.json(
        { error: "Authentication failed", details: userError.message },
        { status: 401 },
      );
    }

    if (!user) {
      console.error("❌ No user found in revoke integration API");
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      );
    }

    console.log(`✅ User authenticated: ${user.id}, revoking app: ${app}`);

    // Get the integration data before deleting
    const { data: integration, error: fetchError } = await supabase
      .from("user_integrations")
      .select("access_token, refresh_token, app, created_at")
      .eq("user_id", user.id)
      .eq("app", app)
      .eq("provider", "google")
      .single();

    if (fetchError) {
      console.error("❌ Error fetching integration:", fetchError);
      if (fetchError.code === "PGRST116") {
        return NextResponse.json(
          { error: `Integration not found for app: ${app}` },
          { status: 404 },
        );
      }
      return NextResponse.json(
        {
          error: "Failed to fetch integration",
          details: fetchError.message,
        },
        { status: 500 },
      );
    }

    if (!integration) {
      console.error(`❌ Integration not found for app: ${app}`);
      return NextResponse.json(
        { error: `Integration not found for app: ${app}` },
        { status: 404 },
      );
    }

    console.log(`🔍 Found integration for ${app}:`, {
      hasAccessToken: !!integration.access_token,
      hasRefreshToken: !!integration.refresh_token,
      createdAt: integration.created_at,
    });

    // Revoke the Google OAuth token if available
    let tokenRevocationStatus = "skipped";
    if (integration.access_token || integration.refresh_token) {
      try {
        console.log(`🔑 Attempting to revoke Google OAuth token for ${app}`);

        // Use refresh_token if available, otherwise use access_token
        const tokenToRevoke =
          integration.refresh_token || integration.access_token;

        if (!tokenToRevoke) {
          console.warn(`⚠️ No token available to revoke for ${app}`);
          tokenRevocationStatus = "no_token";
        } else {
          const revokeResponse = await fetch(
            "https://oauth2.googleapis.com/revoke",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                token: tokenToRevoke,
              }),
            },
          );

          if (revokeResponse.ok) {
            console.log(
              `✅ Successfully revoked Google OAuth token for ${app}`,
            );
            tokenRevocationStatus = "success";
          } else {
            const errorText = await revokeResponse.text();
            console.warn(
              `⚠️ Failed to revoke Google OAuth token for ${app}:`,
              revokeResponse.status,
              revokeResponse.statusText,
              errorText,
            );
            tokenRevocationStatus = "failed";
            // Continue with deletion even if revocation fails
          }
        }
      } catch (revokeError) {
        console.error(
          `❌ Error revoking Google OAuth token for ${app}:`,
          revokeError,
        );
        tokenRevocationStatus = "error";
        // Continue with deletion even if revocation fails
      }
    } else {
      console.log(`ℹ️ No tokens to revoke for ${app}`);
      tokenRevocationStatus = "no_token";
    }

    // Delete the integration from the database
    const { error: deleteError } = await supabase
      .from("user_integrations")
      .delete()
      .eq("user_id", user.id)
      .eq("app", app)
      .eq("provider", "google");

    if (deleteError) {
      console.error("❌ Error deleting integration:", deleteError);
      return NextResponse.json(
        {
          error: "Failed to delete integration",
          details: deleteError.message,
        },
        { status: 500 },
      );
    }

    console.log(`✅ Successfully deleted integration for ${app}`);

    // Invalidate caches since integration was removed
    console.log("🗑️ Invalidating caches for user:", user.id);
    mcpManager.invalidateUserCache(user.id);
    agentManager.getInstance().invalidateUserCache(user.id);

    // Add delay to ensure database transaction is committed before preload
    setTimeout(() => {
      console.log(
        "🔄 Starting delayed MCP preload after revocation for user:",
        user.id,
      );
      mcpManager.preloadUserData(user.id).catch((error) => {
        console.error("❌ Failed to preload MCP data after revocation:", error);
      });
    }, 1000); // 1 second delay

    console.log(`✅ Successfully revoked and deleted integration for ${app}`);

    return NextResponse.json({
      success: true,
      message: `Successfully revoked access for ${app}`,
      app,
      tokenRevocationStatus,
      revokedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Unexpected error in revoke API:", error);
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
