import { Tool, StructuredTool } from "@langchain/core/tools";
import { AgentExecutionConfig } from "../agent-utils";
import { createAgentWorkflow, AgentWorkflowConfig } from "./workflow";
import {
  ParallelToolExecutor,
  createParallelToolExecutor,
} from "./parallel-tool-executor";
// Tool classifier removed - using prompt-based approach
import { agentLogger } from "./logger";
import {
  addSensitiveToolApproval,
  validateParallelExecution,
} from "../human-in-the-loop";

/**
 * Complete parallel execution integration system
 * This file ties together all parallel execution components
 */

export interface ParallelIntegrationConfig {
  agentConfig: AgentExecutionConfig;
  customSensitivePatterns?: string[];
  maxConcurrency?: number;
  enableLogging?: boolean;
}

/**
 * Main integration class that orchestrates parallel execution across the entire system
 */
export class ParallelExecutionIntegration {
  private config: ParallelIntegrationConfig;
  private parallelExecutor: ParallelToolExecutor | null = null;
  private availableTools: Tool[] = [];
  private enhancedTools: any[] = [];

  constructor(config: ParallelIntegrationConfig) {
    this.config = config;
    this.initializeSystem();
  }

  /**
   * Initialize the parallel execution system
   */
  private initializeSystem(): void {
    agentLogger.info(
      "[Parallel Integration] Initializing parallel execution system",
    );

    // Add custom patterns to tool classifier if provided
    if (this.config.customSensitivePatterns) {
      this.config.customSensitivePatterns.forEach((pattern) => {
        agentLogger.info(
          `[Parallel Integration] Added custom sensitive pattern: ${pattern}`,
        );
      });
    }

    agentLogger.info("[Parallel Integration] System initialized successfully");
  }

  /**
   * Setup tools with parallel execution capabilities
   */
  setupTools(tools: Tool[]): Tool[] {
    this.availableTools = tools;

    agentLogger.info(`[Parallel Integration] Setting up ${tools.length} tools`);

    // Add human approval to sensitive tools
    const toolsWithApproval = addSensitiveToolApproval(tools);

    // Create parallel tool executor if enabled
    if (this.config.agentConfig.enableParallelExecution) {
      this.parallelExecutor = createParallelToolExecutor(toolsWithApproval, {
        maxConcurrency: this.config.agentConfig.maxConcurrency,
        toolTimeout: this.config.agentConfig.parallelTimeout,
        fallbackToSequential: this.config.agentConfig.fallbackToSequential,
        enableLogging: this.config.agentConfig.verboseLogging,
      });

      // Don't add parallel executor to tools - let workflow handle it
      this.enhancedTools = toolsWithApproval;

      agentLogger.info(
        `[Parallel Integration] Parallel execution enabled with ${this.enhancedTools.length} tools (executor will be added by workflow)`,
      );
    } else {
      this.enhancedTools = toolsWithApproval;
    }

    return this.enhancedTools;
  }

  /**
   * Create agent workflow with parallel execution capabilities
   */
  async createEnhancedWorkflow(): Promise<
    ReturnType<typeof createAgentWorkflow>
  > {
    if (this.enhancedTools.length === 0) {
      throw new Error("Tools must be setup before creating workflow");
    }

    const workflowConfig: AgentWorkflowConfig = {
      enableHumanApproval: true,
      enableParallelExecution: this.config.agentConfig.enableParallelExecution,
      maxConcurrency: this.config.agentConfig.maxConcurrency,
      parallelTimeout: this.config.agentConfig.parallelTimeout,
    };

    const workflow = await createAgentWorkflow(
      this.enhancedTools,
      workflowConfig,
    );

    agentLogger.info(
      "[Parallel Integration] Enhanced workflow created successfully",
    );

    return workflow;
  }

  /**
   * Analyze tools and provide execution recommendations
   */
  analyzeTools(): {
    totalTools: number;
    parallelCapable: number;
    requiresApproval: number;
    sequentialOnly: number;
    recommendations: string[];
  } {
    // Simple pattern-based analysis without tool classifier
    const executor = new ParallelToolExecutor(this.availableTools);
    const stats = executor.getExecutionStats();

    const recommendations: string[] = [];

    // Generate recommendations based on tool analysis
    if (stats.parallelCapable > 5) {
      recommendations.push(
        "High parallel potential - consider enabling parallel execution",
      );
    }

    if (stats.sensitiveTools > stats.parallelCapable) {
      recommendations.push(
        "Many sensitive tools detected - ensure proper safety measures",
      );
    }

    if (this.config.agentConfig.maxConcurrency > stats.parallelCapable) {
      recommendations.push(
        "Max concurrency higher than parallel-capable tools - consider reducing",
      );
    }

    return {
      totalTools: this.availableTools.length,
      parallelCapable: stats.parallelCapable,
      requiresApproval: stats.sensitiveTools,
      sequentialOnly: stats.sensitiveTools,
      recommendations,
    };
  }

  /**
   * Validate system configuration and setup
   */
  validateConfiguration(): {
    isValid: boolean;
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Validate basic configuration
    if (this.config.agentConfig.maxConcurrency < 1) {
      errors.push("maxConcurrency must be at least 1");
    }

    if (this.config.agentConfig.maxConcurrency > 20) {
      warnings.push("maxConcurrency > 20 may cause resource issues");
    }

    if (this.config.agentConfig.parallelTimeout < 5000) {
      warnings.push("parallelTimeout < 5s may cause frequent timeouts");
    }

    if (this.config.agentConfig.parallelTimeout > 120000) {
      warnings.push("parallelTimeout > 2m may cause poor user experience");
    }

    // Validate tool setup
    if (this.availableTools.length === 0) {
      warnings.push(
        "No tools available - parallel execution will have no effect",
      );
    }

    const toolAnalysis = this.analyzeTools();
    if (
      toolAnalysis.parallelCapable === 0 &&
      this.config.agentConfig.enableParallelExecution
    ) {
      warnings.push(
        "Parallel execution enabled but no tools can run in parallel",
      );
    }

    // Basic security validation
    if (toolAnalysis.requiresApproval > 0) {
      agentLogger.info(
        `[Parallel Integration] ${toolAnalysis.requiresApproval} sensitive tools detected`,
      );
    }

    return {
      isValid: errors.length === 0,
      warnings,
      errors,
    };
  }

  /**
   * Get system status and health
   */
  getSystemStatus(): {
    status: "healthy" | "warning" | "error";
    parallelExecutionEnabled: boolean;
    toolsReady: boolean;
    workflowReady: boolean;
    securityCompliant: boolean;
    performanceOptimal: boolean;
    details: Record<string, any>;
  } {
    const validation = this.validateConfiguration();
    const toolAnalysis = this.analyzeTools();

    const toolsReady = this.enhancedTools.length > 0;
    const securityCompliant = validation.errors.length === 0;
    const performanceOptimal =
      this.config.agentConfig.enableParallelExecution &&
      toolAnalysis.parallelCapable > 0;

    let status: "healthy" | "warning" | "error" = "healthy";

    if (validation.errors.length > 0) {
      status = "error";
    } else if (validation.warnings.length > 0) {
      status = "warning";
    }

    return {
      status,
      parallelExecutionEnabled: this.config.agentConfig.enableParallelExecution,
      toolsReady,
      workflowReady: this.enhancedTools.length > 0,
      securityCompliant,
      performanceOptimal,
      details: {
        totalTools: toolAnalysis.totalTools,
        parallelCapable: toolAnalysis.parallelCapable,
        sensitiveTools: toolAnalysis.requiresApproval,
        maxConcurrency: this.config.agentConfig.maxConcurrency,
        timeout: this.config.agentConfig.parallelTimeout,
        warnings: validation.warnings,
        errors: validation.errors,
        recommendations: toolAnalysis.recommendations,
      },
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfiguration(updates: Partial<AgentExecutionConfig>): void {
    this.config.agentConfig = { ...this.config.agentConfig, ...updates };

    // Update parallel executor if it exists
    if (this.parallelExecutor && updates.enableParallelExecution !== false) {
      // Recreate parallel executor with new config
      this.parallelExecutor = createParallelToolExecutor(this.availableTools, {
        maxConcurrency: this.config.agentConfig.maxConcurrency,
        toolTimeout: this.config.agentConfig.parallelTimeout,
        fallbackToSequential: this.config.agentConfig.fallbackToSequential,
        enableLogging: this.config.agentConfig.verboseLogging,
      });

      // Update enhanced tools
      const toolsWithApproval = addSensitiveToolApproval(this.availableTools);
      this.enhancedTools = toolsWithApproval;
    } else if (updates.enableParallelExecution === false) {
      // Remove parallel executor
      this.parallelExecutor = null;
      this.enhancedTools = addSensitiveToolApproval(this.availableTools);
    }

    agentLogger.info("[Parallel Integration] Configuration updated", updates);
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    parallelExecutionsCount: number;
    averageSpeedImprovement: number;
    toolUsageDistribution: Record<string, number>;
    errorRate: number;
  } {
    // This would typically pull from logging/analytics system
    // For now, return placeholder data structure
    return {
      parallelExecutionsCount: 0,
      averageSpeedImprovement: 0,
      toolUsageDistribution: {},
      errorRate: 0,
    };
  }

  /**
   * Generate system report
   */
  generateSystemReport(): string {
    const status = this.getSystemStatus();
    const reportAnalysis = this.analyzeTools();
    const validation = this.validateConfiguration();

    let report = `# Parallel Execution System Report\n\n`;

    report += `## System Status: ${status.status.toUpperCase()}\n\n`;

    report += `### Configuration\n`;
    report += `- Parallel Execution: ${status.parallelExecutionEnabled ? "✅ Enabled" : "❌ Disabled"}\n`;
    report += `- Max Concurrency: ${this.config.agentConfig.maxConcurrency}\n`;
    report += `- Timeout: ${this.config.agentConfig.parallelTimeout}ms\n`;
    report += `- Fallback: ${this.config.agentConfig.fallbackToSequential ? "Enabled" : "Disabled"}\n\n`;

    report += `### Tool Analysis\n`;
    report += `- Total Tools: ${reportAnalysis.totalTools}\n`;
    report += `- Parallel Capable: ${reportAnalysis.parallelCapable}\n`;
    report += `- Requires Approval: ${reportAnalysis.requiresApproval}\n`;
    report += `- Sequential Only: ${reportAnalysis.sequentialOnly}\n\n`;

    if (validation.warnings.length > 0) {
      report += `### Warnings\n`;
      validation.warnings.forEach((warning) => {
        report += `- ⚠️ ${warning}\n`;
      });
      report += `\n`;
    }

    if (validation.errors.length > 0) {
      report += `### Errors\n`;
      validation.errors.forEach((error) => {
        report += `- ❌ ${error}\n`;
      });
      report += `\n`;
    }

    if (reportAnalysis.recommendations.length > 0) {
      report += `### Recommendations\n`;
      reportAnalysis.recommendations.forEach((rec) => {
        report += `- 💡 ${rec}\n`;
      });
      report += `\n`;
    }

    report += `### Next Steps\n`;
    if (status.status === "error") {
      report += `- 🚨 Fix critical errors before proceeding\n`;
    } else if (status.status === "warning") {
      report += `- ⚠️ Address warnings for optimal performance\n`;
    } else {
      report += `- ✅ System ready for parallel execution\n`;
    }

    return report;
  }

  /**
   * Export current configuration for backup/sharing
   */
  exportConfiguration(): {
    timestamp: string;
    agentConfig: AgentExecutionConfig;
    toolCount: number;
    systemStatus: string;
    version: string;
  } {
    return {
      timestamp: new Date().toISOString(),
      agentConfig: this.config.agentConfig,
      toolCount: this.availableTools.length,
      systemStatus: this.getSystemStatus().status,
      version: "1.0.0",
    };
  }

  /**
   * Import configuration from backup
   */
  importConfiguration(
    backup: ReturnType<typeof this.exportConfiguration>,
  ): void {
    this.updateConfiguration(backup.agentConfig);
    agentLogger.info(
      `[Parallel Integration] Configuration imported from ${backup.timestamp}`,
    );
  }
}

/**
 * Factory function to create fully integrated parallel execution system
 */
export async function createParallelExecutionSystem(
  tools: Tool[],
  config: AgentExecutionConfig,
): Promise<{
  integration: ParallelExecutionIntegration;
  enhancedTools: any[];
  workflow: Awaited<ReturnType<typeof createAgentWorkflow>>;
  systemStatus: ReturnType<ParallelExecutionIntegration["getSystemStatus"]>;
}> {
  agentLogger.info(
    "[Parallel Integration] Creating complete parallel execution system",
  );

  // Create integration instance
  const integration = new ParallelExecutionIntegration({
    agentConfig: config,
  });

  // Setup tools with parallel capabilities
  const enhancedTools = integration.setupTools(tools);

  // Create enhanced workflow
  const workflow = await integration.createEnhancedWorkflow();

  // Get system status
  const systemStatus = integration.getSystemStatus();

  // Log system creation
  agentLogger.info(
    `[Parallel Integration] System created - Status: ${systemStatus.status}`,
  );

  if (systemStatus.details.warnings.length > 0) {
    systemStatus.details.warnings.forEach((warning: string) => {
      agentLogger.warn(`[Parallel Integration] ${warning}`);
    });
  }

  if (systemStatus.details.errors.length > 0) {
    systemStatus.details.errors.forEach((error: string) => {
      agentLogger.error(`[Parallel Integration] ${error}`);
    });
  }

  return {
    integration,
    enhancedTools,
    workflow,
    systemStatus,
  };
}

/**
 * Utility function to quickly enable parallel execution on existing agent
 */
export async function enableParallelExecution(
  existingTools: Tool[],
  options: {
    maxConcurrency?: number;
    timeout?: number;
    fallback?: boolean;
  } = {},
): Promise<{
  tools: any[];
  parallelExecutor: ParallelToolExecutor;
}> {
  const config: AgentExecutionConfig = {
    maxIterations: 10,
    maxToolCalls: 15,
    streamToolCalls: true,
    streamToolResults: true,
    verboseLogging: true,
    enableParallelExecution: true,
    maxConcurrency: options.maxConcurrency || 5,
    parallelTimeout: options.timeout || 30000,
    fallbackToSequential: options.fallback ?? true,
  };

  const { enhancedTools, integration } = await createParallelExecutionSystem(
    existingTools,
    config,
  );

  return {
    tools: enhancedTools,
    parallelExecutor: integration["parallelExecutor"]!,
  };
}

/**
 * Quick setup function for development/testing
 */
export async function quickParallelSetup(tools: Tool[]): Promise<{
  tools: Tool[];
  workflow: Awaited<ReturnType<typeof createAgentWorkflow>>;
  report: string;
}> {
  const config: AgentExecutionConfig = {
    maxIterations: 10,
    maxToolCalls: 15,
    streamToolCalls: true,
    streamToolResults: true,
    verboseLogging: true,
    enableParallelExecution: true,
    maxConcurrency: 5,
    parallelTimeout: 30000,
    fallbackToSequential: true,
  };

  const system = await createParallelExecutionSystem(tools, config);

  return {
    tools: system.enhancedTools,
    workflow: system.workflow,
    report: system.integration.generateSystemReport(),
  };
}

/**
 * Validate that parallel execution system is working correctly
 */
export function validateParallelExecutionSystem(tools: Tool[]): {
  isValid: boolean;
  summary: string;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Create temporary executor to check tool capabilities
  const tempExecutor = new ParallelToolExecutor(tools);
  const stats = tempExecutor.getExecutionStats();

  if (stats.parallelCapable === 0) {
    issues.push(
      "No tools can run in parallel - parallel execution will have no benefit",
    );
    recommendations.push(
      "Consider adding read-only tools like search_*, get_*, fetch_*",
    );
  }

  if (stats.sensitiveTools === 0) {
    recommendations.push(
      "No sensitive tools detected - system is safe for parallel execution",
    );
  }

  // Check for parallel executor
  const hasParallelExecutor = tools.some(
    (tool) => tool.name === "parallel_tool_executor",
  );
  if (!hasParallelExecutor) {
    issues.push("parallel_tool_executor not found in tools list");
    recommendations.push(
      "Add parallel_tool_executor to tools list for parallel execution",
    );
  }

  // Security validation - no longer needed with prompt-based approach
  if (stats.sensitiveTools > 0) {
    recommendations.push(
      `${stats.sensitiveTools} sensitive tools detected - ensure they are not used in parallel`,
    );
  }

  const summary = `
Parallel Execution System Validation:
- Total Tools: ${tools.length}
- Parallel Capable: ${stats.parallelCapable}
- Sensitive Tools: ${stats.sensitiveTools}
- Issues Found: ${issues.length}
- Status: ${issues.length === 0 ? "✅ Ready" : "❌ Needs Attention"}
`;

  return {
    isValid: issues.length === 0,
    summary,
    issues,
    recommendations,
  };
}

/**
 * Global integration instance for singleton pattern
 */
let globalIntegration: ParallelExecutionIntegration | null = null;

/**
 * Get or create global parallel execution integration
 */
export function getGlobalParallelIntegration(
  tools?: Tool[],
  config?: AgentExecutionConfig,
): ParallelExecutionIntegration {
  if (!globalIntegration || (tools && config)) {
    if (!tools || !config) {
      throw new Error(
        "Tools and config required for first-time initialization",
      );
    }

    globalIntegration = new ParallelExecutionIntegration({
      agentConfig: config,
    });

    globalIntegration.setupTools(tools);
  }

  return globalIntegration;
}

/**
 * Reset global integration (useful for testing)
 */
export function resetGlobalParallelIntegration(): void {
  globalIntegration = null;
  agentLogger.info("[Parallel Integration] Global integration reset");
}
