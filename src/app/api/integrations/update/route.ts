import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mcpManager } from "@/lib/mcp-manager";
import { agentManager } from "@/lib/agent";

interface UpdateRequest {
  app: string;
  description?: string;
  tools?: string[];
}

export async function POST(request: Request) {
  try {
    console.log("🔄 Update integration API called");

    // Parse request body
    let body: UpdateRequest;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error("❌ Failed to parse request body:", parseError);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const { app, description, tools } = body;

    if (!app) {
      console.error("❌ App name is required");
      return NextResponse.json(
        { error: "App name is required" },
        { status: 400 },
      );
    }

    console.log(`🔄 Updating integration settings for app: ${app}`);

    const supabase = await createClient();

    // Get the authenticated user with better error handling
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("❌ Auth error in update integration API:", userError);
      return NextResponse.json(
        { error: "Authentication failed", details: userError.message },
        { status: 401 },
      );
    }

    if (!user) {
      console.error("❌ No user found in update integration API");
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      );
    }

    console.log(`✅ User authenticated: ${user.id}, updating app: ${app}`);

    // Check if integration exists
    const { data: existingIntegration, error: fetchError } = await supabase
      .from("user_integrations")
      .select("id, app, description, tools")
      .eq("user_id", user.id)
      .eq("app", app)
      .eq("provider", "google")
      .single();

    if (fetchError) {
      console.error("❌ Error fetching existing integration:", fetchError);
      if (fetchError.code === "PGRST116") {
        return NextResponse.json(
          { error: `Integration not found for app: ${app}` },
          { status: 404 },
        );
      }
      return NextResponse.json(
        {
          error: "Failed to check existing integration",
          details: fetchError.message,
        },
        { status: 500 },
      );
    }

    if (!existingIntegration) {
      console.error(`❌ Integration not found for app: ${app}`);
      return NextResponse.json(
        { error: `Integration not found for app: ${app}` },
        { status: 404 },
      );
    }

    console.log("🔍 Found existing integration:", {
      id: existingIntegration.id,
      app: existingIntegration.app,
      currentDescription: existingIntegration.description,
      currentTools: existingIntegration.tools,
    });

    // Prepare update data
    const updateData: any = {
      last_updated: new Date().toISOString(),
    };

    if (description !== undefined) {
      updateData.description = description;
      console.log(`📝 Updating description to: ${description}`);
    }

    if (tools !== undefined) {
      if (!Array.isArray(tools)) {
        console.error("❌ Tools must be an array");
        return NextResponse.json(
          { error: "Tools must be an array" },
          { status: 400 },
        );
      }
      updateData.tools = tools;
      console.log(`🛠️ Updating tools to:`, tools);
    }

    // Update the integration
    const { data: updatedData, error: updateError } = await supabase
      .from("user_integrations")
      .update(updateData)
      .eq("user_id", user.id)
      .eq("app", app)
      .eq("provider", "google")
      .select("*")
      .single();

    if (updateError) {
      console.error("❌ Error updating integration:", updateError);
      return NextResponse.json(
        {
          error: "Failed to update integration settings",
          details: updateError.message,
        },
        { status: 500 },
      );
    }

    console.log(`✅ Successfully updated integration settings for ${app}:`, {
      updatedFields: Object.keys(updateData),
      newDescription: updatedData?.description,
      newTools: updatedData?.tools,
    });

    // Invalidate caches since integration settings changed
    console.log("🗑️ Invalidating caches for user:", user.id);
    mcpManager.invalidateUserCache(user.id);
    agentManager.getInstance().invalidateUserCache(user.id);

    // Add delay to ensure database transaction is committed before preload
    setTimeout(() => {
      console.log(
        "🔄 Starting delayed MCP preload after update for user:",
        user.id,
      );
      mcpManager.preloadUserData(user.id).catch((error) => {
        console.error("❌ Failed to preload MCP data after update:", error);
      });
    }, 1000); // 1 second delay

    return NextResponse.json({
      success: true,
      message: `Successfully updated ${app} integration settings`,
      updatedAt: updateData.last_updated,
      integration: {
        app: updatedData.app,
        description: updatedData.description,
        tools: updatedData.tools,
        lastUpdated: updatedData.last_updated,
      },
    });
  } catch (error) {
    console.error("❌ Unexpected error in update integration API:", error);
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
