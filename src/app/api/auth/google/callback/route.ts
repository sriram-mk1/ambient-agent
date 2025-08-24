import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { mcpManager } from "@/lib/mcp-manager";
import { agentManager } from "@/lib/agent/manager";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  console.log("🔄 Google OAuth callback received:", {
    hasCode: !!code,
    hasState: !!state,
    hasError: !!error,
    fullUrl: request.url,
  });

  // Handle OAuth errors
  if (error) {
    console.error("❌ OAuth error received:", error);
    const errorMessage = encodeURIComponent(`OAuth error: ${error}`);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/connections?error=${errorMessage}`,
    );
  }

  // Validate required parameters
  if (!code || !state) {
    console.error("❌ Missing required OAuth parameters:", {
      code: !!code,
      state: !!state,
    });
    const errorMessage = encodeURIComponent("Missing OAuth parameters");
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/connections?error=${errorMessage}`,
    );
  }

  // Decode and validate state
  let stateData: any;
  try {
    const decodedState = Buffer.from(state, "base64").toString("utf-8");
    stateData = JSON.parse(decodedState);

    console.log("🔐 Decoded state:", {
      userId: stateData.userId,
      app: stateData.app,
      timestamp: stateData.timestamp,
      forceReauth: stateData.forceReauth,
    });

    // Validate state structure
    if (!stateData.userId || !stateData.app || !stateData.timestamp) {
      throw new Error("Invalid state structure");
    }

    // Check state timestamp (should be within 1 hour for security)
    const stateAge = Date.now() - stateData.timestamp;
    const oneHour = 60 * 60 * 1000;
    if (stateAge > oneHour) {
      throw new Error("State parameter expired");
    }
  } catch (err) {
    console.error("❌ Error parsing/validating state:", err);
    const errorMessage = encodeURIComponent("Invalid or expired OAuth state");
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/connections?error=${errorMessage}`,
    );
  }

  const { userId, app, forceReauth } = stateData;

  try {
    console.log(
      `🔄 Processing OAuth callback for user: ${userId}, app: ${app}`,
    );

    const supabase = await createClient();

    // Verify the authenticated user matches the state
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || user.id !== userId) {
      console.error("❌ User authentication error or mismatch:", {
        userError: userError?.message,
        hasUser: !!user,
        userIdMatch: user?.id === userId,
      });

      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("redirect", "/dashboard/connections");
      redirectUrl.searchParams.set("error", "authentication_mismatch");
      return NextResponse.redirect(redirectUrl);
    }

    console.log(`✅ User verification successful: ${userId}`);

    // Validate environment variables
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error("Missing Google OAuth configuration");
    }

    // Initialize OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI,
    );

    console.log("🔄 Exchanging authorization code for tokens...");

    // Exchange the authorization code for tokens
    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI,
    });

    console.log("🔑 Tokens received:", {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      hasIdToken: !!tokens.id_token,
      expiryDate: tokens.expiry_date,
      scope: tokens.scope,
      tokenType: tokens.token_type,
    });

    if (!tokens.access_token) {
      throw new Error("No access token received from Google");
    }

    // Check for existing integration
    const { data: existingIntegration, error: fetchError } = await supabase
      .from("user_integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("app", app)
      .eq("provider", "google")
      .maybeSingle();

    if (fetchError) {
      console.warn(
        "⚠️ Warning: Could not check for existing integration:",
        fetchError,
      );
    }

    console.log("🔍 Existing integration check:", {
      found: !!existingIntegration,
      existingId: existingIntegration?.id,
      hasExistingRefreshToken: !!existingIntegration?.refresh_token,
    });

    // Calculate expiry time
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600000).toISOString(); // Default to 1 hour

    // Prepare integration data
    const integrationData = {
      id: `${userId}_${app}`, // Unique ID combining user ID and app
      user_id: userId,
      provider: "google",
      app: app,
      access_token: tokens.access_token,
      refresh_token:
        tokens.refresh_token || existingIntegration?.refresh_token || null,
      expires_at: expiresAt,
      token_type: tokens.token_type || "Bearer",
      scope: tokens.scope || "",
      last_updated: new Date().toISOString(),
      // Preserve existing data if this is an update
      description: existingIntegration?.description || null,
      tools: existingIntegration?.tools || [],
      created_at: existingIntegration?.created_at || new Date().toISOString(),
    };

    console.log("💾 Saving integration data:", {
      id: integrationData.id,
      app: integrationData.app,
      hasAccessToken: !!integrationData.access_token,
      hasRefreshToken: !!integrationData.refresh_token,
      expiresAt: integrationData.expires_at,
      isUpdate: !!existingIntegration,
    });

    // Save or update the integration for all Google apps (including Drive)
    const { error: dbError } = await supabase
      .from("user_integrations")
      .upsert(integrationData, {
        onConflict: "id",
        ignoreDuplicates: false,
      });

    if (dbError) {
      console.error("❌ Database error:", dbError);
      throw new Error(`Failed to save tokens: ${dbError.message}`);
    }

    console.log("✅ Integration data saved successfully");

    // Handle cache invalidation and preloading
    console.log("🗑️ Invalidating caches for user:", userId);
    mcpManager.invalidateUserCache(userId);
    agentManager.invalidateUserCache(userId);

    // Add delay to ensure database transaction is committed before preload
    setTimeout(() => {
      console.log(
        "🔄 Starting delayed MCP preload after OAuth connection for user:",
        userId,
      );
      mcpManager.preloadUserData(userId).catch((error) => {
        console.error("❌ Failed to preload MCP data after OAuth:", error);
      });
    }, 1000); // 1 second delay

    // Determine success message based on whether this was a reconnection
    const isReconnection = !!existingIntegration;
    const successMessage = isReconnection
      ? `${app}_reconnected`
      : `${app}_connected`;

    console.log(`✅ OAuth flow completed successfully for ${app}`, {
      userId,
      app,
      isReconnection,
      forceReauth,
    });

    // Redirect to success page
    const redirectUrl = new URL(
      "/dashboard/connections",
      process.env.NEXT_PUBLIC_APP_URL!,
    );
    redirectUrl.searchParams.set("success", successMessage);
    redirectUrl.searchParams.set("app", app);
    if (isReconnection) {
      redirectUrl.searchParams.set("reconnected", "true");
    }

    return NextResponse.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("❌ Google OAuth Error:", err);

    // Provide specific error handling
    let errorMessage = "oauth_error";
    let errorDetails = "";

    if (err instanceof Error) {
      errorDetails = err.message;

      if (err.message.includes("invalid_grant")) {
        errorMessage = "invalid_authorization_code";
      } else if (err.message.includes("access_denied")) {
        errorMessage = "user_denied_access";
      } else if (err.message.includes("Invalid authorization code")) {
        errorMessage = "expired_authorization_code";
      } else if (err.message.includes("Failed to save tokens")) {
        errorMessage = "database_error";
      }
    }

    console.error("❌ Detailed error info:", {
      errorMessage,
      errorDetails,
      userId,
      app,
    });

    const redirectUrl = new URL(
      "/dashboard/connections",
      process.env.NEXT_PUBLIC_APP_URL!,
    );
    redirectUrl.searchParams.set("error", errorMessage);
    if (errorDetails) {
      redirectUrl.searchParams.set("details", encodeURIComponent(errorDetails));
    }
    if (app) {
      redirectUrl.searchParams.set("app", app);
    }

    return NextResponse.redirect(redirectUrl.toString());
  }
}

// Export dynamic to ensure fresh processing
export const dynamic = "force-dynamic";
