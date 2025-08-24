import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  AgentExecutionConfig,
  DEFAULT_AGENT_CONFIG,
  CONSERVATIVE_AGENT_CONFIG,
  EXTENDED_AGENT_CONFIG,
} from "@/lib/agent-utils";

interface ConfigRequest {
  preset?: "default" | "conservative" | "extended" | "custom";
  config?: Partial<AgentExecutionConfig>;
}

interface ConfigResponse {
  success: boolean;
  config?: AgentExecutionConfig;
  presets?: Record<string, AgentExecutionConfig>;
  error?: string;
}

// In-memory storage for user configurations (in production, use database)
const userConfigs = new Map<string, AgentExecutionConfig>();

const PRESET_CONFIGS = {
  default: DEFAULT_AGENT_CONFIG,
  conservative: CONSERVATIVE_AGENT_CONFIG,
  extended: EXTENDED_AGENT_CONFIG,
};

function validateConfig(config: Partial<AgentExecutionConfig>): string[] {
  const errors: string[] = [];

  if (config.maxIterations !== undefined) {
    if (config.maxIterations < 1 || config.maxIterations > 200) {
      errors.push("maxIterations must be between 1 and 200");
    }
  }

  if (config.maxToolCalls !== undefined) {
    if (config.maxToolCalls < 1 || config.maxToolCalls > 500) {
      errors.push("maxToolCalls must be between 1 and 500");
    }
  }

  if (
    config.streamToolCalls !== undefined &&
    typeof config.streamToolCalls !== "boolean"
  ) {
    errors.push("streamToolCalls must be a boolean");
  }

  if (
    config.streamToolResults !== undefined &&
    typeof config.streamToolResults !== "boolean"
  ) {
    errors.push("streamToolResults must be a boolean");
  }

  if (
    config.verboseLogging !== undefined &&
    typeof config.verboseLogging !== "boolean"
  ) {
    errors.push("verboseLogging must be a boolean");
  }

  // Parallel execution validation
  if (
    config.enableParallelExecution !== undefined &&
    typeof config.enableParallelExecution !== "boolean"
  ) {
    errors.push("enableParallelExecution must be a boolean");
  }

  if (config.maxConcurrency !== undefined) {
    if (config.maxConcurrency < 1 || config.maxConcurrency > 50) {
      errors.push("maxConcurrency must be between 1 and 50");
    }
  }

  if (config.parallelTimeout !== undefined) {
    if (config.parallelTimeout < 1000 || config.parallelTimeout > 300000) {
      errors.push("parallelTimeout must be between 1000ms and 300000ms");
    }
  }

  if (
    config.fallbackToSequential !== undefined &&
    typeof config.fallbackToSequential !== "boolean"
  ) {
    errors.push("fallbackToSequential must be a boolean");
  }

  return errors;
}

function mergeConfigs(
  base: AgentExecutionConfig,
  override: Partial<AgentExecutionConfig>,
): AgentExecutionConfig {
  return {
    ...base,
    ...override,
  };
}

async function getUserId(request: Request): Promise<string | null> {
  try {
    const serverSupabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await serverSupabase.auth.getUser();

    if (userError || !user) {
      console.log("No authenticated user found");
      return null;
    }

    return user.id;
  } catch (error) {
    console.error("Error getting user:", error);
    return null;
  }
}

export async function GET(request: Request) {
  console.log("🔧 Agent config GET request received");

  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    // Get user's current config or default
    const userConfig = userConfigs.get(userId) || DEFAULT_AGENT_CONFIG;

    const response: ConfigResponse = {
      success: true,
      config: userConfig,
      presets: PRESET_CONFIGS,
    };

    console.log("✅ Returning agent config for user:", userId);
    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ Error getting agent config:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  console.log("🔧 Agent config POST request received");

  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const { preset, config: customConfig }: ConfigRequest =
      await request.json();

    let newConfig: AgentExecutionConfig;

    if (preset && preset !== "custom") {
      // Use preset configuration
      if (!PRESET_CONFIGS[preset]) {
        return NextResponse.json(
          { success: false, error: `Invalid preset: ${preset}` },
          { status: 400 },
        );
      }

      newConfig = PRESET_CONFIGS[preset];
      console.log(`📋 Using preset config: ${preset}`);
    } else if (customConfig) {
      // Validate custom configuration
      const validationErrors = validateConfig(customConfig);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Configuration validation errors: ${validationErrors.join(", ")}`,
          },
          { status: 400 },
        );
      }

      // Merge with current config or default
      const currentConfig = userConfigs.get(userId) || DEFAULT_AGENT_CONFIG;
      newConfig = mergeConfigs(currentConfig, customConfig);
      console.log("🛠️ Using custom config");
    } else {
      return NextResponse.json(
        { success: false, error: "Either preset or config must be provided" },
        { status: 400 },
      );
    }

    // Store the new configuration
    userConfigs.set(userId, newConfig);

    console.log("✅ Agent config updated for user:", userId);
    console.log("📋 New config:", newConfig);

    const response: ConfigResponse = {
      success: true,
      config: newConfig,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ Error updating agent config:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  // PUT behaves the same as POST for this endpoint
  return POST(request);
}

export async function DELETE(request: Request) {
  console.log("🔧 Agent config DELETE request received");

  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    // Reset to default configuration
    userConfigs.delete(userId);

    console.log("🗑️ Agent config reset to default for user:", userId);

    const response: ConfigResponse = {
      success: true,
      config: DEFAULT_AGENT_CONFIG,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ Error resetting agent config:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
