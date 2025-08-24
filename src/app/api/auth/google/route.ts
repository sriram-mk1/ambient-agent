import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getUser } from "@/lib/supabase/server";

const SCOPES: Record<string, string[]> = {
  gmail: [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  sheets: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ],
  docs: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  drive: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ],
};

export async function GET(request: NextRequest) {
  try {
    console.log("🔑 Google OAuth initiation API called");

    const { searchParams } = new URL(request.url);
    const app = searchParams.get("app");
    const forceReauth = searchParams.get("force") === "true";

    console.log(
      `📱 OAuth request for app: ${app}, force reauth: ${forceReauth}`,
    );

    if (!app || !SCOPES[app]) {
      console.error("❌ Invalid or missing app parameter:", app);
      return NextResponse.json(
        {
          error: "Invalid app parameter",
          validApps: Object.keys(SCOPES),
          received: app,
        },
        { status: 400 },
      );
    }

    // Get the authenticated user
    const user = await getUser();

    if (!user) {
      console.error("❌ User not authenticated in OAuth flow");
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      );
    }

    console.log(`✅ User authenticated: ${user.id} for app: ${app}`);

    // Validate environment variables
    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI
    ) {
      console.error("❌ Missing required Google OAuth environment variables");
      return NextResponse.json(
        { error: "OAuth configuration error" },
        { status: 500 },
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI,
    );

    // Create state with user ID, app, and timestamp for security
    const state = {
      userId: user.id,
      app,
      timestamp: Date.now(),
      forceReauth,
    };

    const encodedState = Buffer.from(JSON.stringify(state)).toString("base64");

    console.log(`🔗 Generating OAuth URL for ${app} with scopes:`, SCOPES[app]);

    // Generate OAuth URL with proper parameters for offline access
    const authUrl = oauth2Client.generateAuthUrl({
      // CRITICAL: Request offline access to get refresh tokens
      access_type: "offline",

      // CRITICAL: Force consent to ensure we get a refresh token
      // This is especially important for users who have already granted access
      prompt: forceReauth ? "consent" : "select_account consent",

      // Include granted scopes to allow incremental authorization
      include_granted_scopes: true,

      // Request specific scopes for this app
      scope: SCOPES[app],

      // Pass encoded state for security and app identification
      state: encodedState,

      // Ensure we use the correct redirect URI
      redirect_uri: process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI,

      // Request ID token for additional user verification if needed
      response_type: "code",
    });

    console.log(`✅ OAuth URL generated successfully for ${app}`);
    console.log(`🔐 State encoded:`, encodedState);
    console.log(
      `🌐 Redirect URI:`,
      process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI,
    );

    return NextResponse.json({
      url: authUrl,
      app,
      userId: user.id,
      scopes: SCOPES[app],
      state: encodedState,
      forceReauth,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error in Google OAuth route:", error);

    // Provide more detailed error information
    const errorDetails = {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    };

    console.error("❌ Detailed error:", errorDetails);

    return NextResponse.json(
      {
        error: "Internal server error during OAuth initialization",
        details: errorDetails.message,
        timestamp: errorDetails.timestamp,
      },
      { status: 500 },
    );
  }
}

// Export dynamic to ensure fresh tokens and user data
export const dynamic = "force-dynamic";
