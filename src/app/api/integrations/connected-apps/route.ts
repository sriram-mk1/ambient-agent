import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    console.log("🔍 Connected apps API called");

    const supabase = await createClient();

    // Get the authenticated user with better error handling
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("❌ Auth error in connected-apps API:", userError);
      return NextResponse.json(
        { error: "Authentication failed", details: userError.message },
        { status: 401 },
      );
    }

    if (!user) {
      console.error("❌ No user found in connected-apps API");
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      );
    }

    console.log("✅ User authenticated:", user.id);

    // Fetch connected integrations for the current user
    const { data: integrations, error: dbError } = await supabase
      .from("user_integrations")
      .select(
        "app, created_at, description, tools, access_token, refresh_token, expires_at",
      )
      .eq("user_id", user.id)
      .eq("provider", "google");

    if (dbError) {
      console.error("❌ Database error fetching connected apps:", dbError);
      return NextResponse.json(
        { error: "Failed to fetch connected apps", details: dbError.message },
        { status: 500 },
      );
    }

    console.log("📊 Found integrations:", {
      count: integrations?.length || 0,
      apps: integrations?.map((i) => i.app) || [],
    });

    // Transform the data to include authentication status
    const connectedApps = (integrations || []).map((integration) => {
      const hasAnyToken = !!(
        integration.access_token || integration.refresh_token
      );
      const isTokenExpired = integration.expires_at
        ? new Date(integration.expires_at) < new Date()
        : false;

      // If no tokens at all, it means they were invalidated (invalid_grant)
      const needsReconnection = !hasAnyToken;

      return {
        app: integration.app,
        created_at: integration.created_at,
        description: integration.description || "",
        tools: Array.isArray(integration.tools) ? integration.tools : [],
        hasValidToken: hasAnyToken && !isTokenExpired,
        tokenExpired: isTokenExpired,
        needsReconnection,
      };
    });

    console.log("✅ Returning connected apps:", {
      totalApps: connectedApps.length,
      appsNeedingReauth: connectedApps.filter((app) => app.needsReconnection)
        .length,
      apps: connectedApps.map((app) => ({
        name: app.app,
        hasValidToken: app.hasValidToken,
        needsReconnection: app.needsReconnection,
      })),
    });

    return NextResponse.json({
      connectedApps,
      totalCount: connectedApps.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Unexpected error in connected-apps API:", error);
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

// Mark as dynamic to ensure fresh data on each request
export const dynamic = "force-dynamic";
