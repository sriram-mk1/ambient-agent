"use client";

import { useState, useEffect, useCallback } from "react";
import { AgentExecutionConfig } from "@/lib/agent-utils";

// Narrow type for API responses to avoid `unknown` JSON issues
type AgentConfigApiResponse = {
  success: boolean;
  config?: AgentExecutionConfig;
  presets?: Record<string, AgentExecutionConfig>;
  error?: string;
};

export interface UseAgentConfigReturn {
  config: AgentExecutionConfig | null;
  isLoading: boolean;
  error: string | null;
  updateConfig: (updates: Partial<AgentExecutionConfig>) => Promise<void>;
  resetConfig: () => Promise<void>;
  loadConfig: () => Promise<void>;
  presets: Record<string, AgentExecutionConfig>;
  hasUnsavedChanges: boolean;
  applyPreset: (presetName: keyof typeof PRESET_CONFIGS) => Promise<void>;
  updateLocalConfig: (updates: Partial<AgentExecutionConfig>) => void;
}

const DEFAULT_CONFIG: AgentExecutionConfig = {
  maxIterations: 50,
  maxToolCalls: 100,
  streamToolCalls: true,
  streamToolResults: true,
  verboseLogging: true,
  enableParallelExecution: true,
  maxConcurrency: 10,
  parallelTimeout: 120000,
  fallbackToSequential: true,
};

const PRESET_CONFIGS = {
  conservative: {
    maxIterations: 10,
    maxToolCalls: 20,
    streamToolCalls: true,
    streamToolResults: false,
    verboseLogging: false,
    enableParallelExecution: false,
    maxConcurrency: 3,
    parallelTimeout: 60000,
    fallbackToSequential: true,
  },
  balanced: {
    maxIterations: 50,
    maxToolCalls: 100,
    streamToolCalls: true,
    streamToolResults: true,
    verboseLogging: true,
    enableParallelExecution: true,
    maxConcurrency: 10,
    parallelTimeout: 120000,
    fallbackToSequential: true,
  },
  aggressive: {
    maxIterations: 100,
    maxToolCalls: 200,
    streamToolCalls: true,
    streamToolResults: true,
    verboseLogging: true,
    enableParallelExecution: true,
    maxConcurrency: 20,
    parallelTimeout: 180000,
    fallbackToSequential: false,
  },
};

export function useAgentConfig(): UseAgentConfigReturn {
  const [config, setConfig] = useState<AgentExecutionConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalConfig, setOriginalConfig] =
    useState<AgentExecutionConfig | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load configuration from API
  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent-config", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }

      const data: AgentConfigApiResponse = await response.json();

      if (data.success && data.config) {
        setConfig(data.config);
        setOriginalConfig(data.config);
        setHasUnsavedChanges(false);
        console.log("✅ Agent config loaded:", data.config);
      } else {
        throw new Error(data.error || "Failed to load configuration");
      }
    } catch (err) {
      console.error("❌ Error loading agent config:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      // Fallback to default config
      setConfig(DEFAULT_CONFIG);
      setOriginalConfig(DEFAULT_CONFIG);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update configuration
  const updateConfig = useCallback(
    async (updates: Partial<AgentExecutionConfig>) => {
      if (!config) {
        setError("No configuration loaded");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const newConfig = { ...config, ...updates };

        const response = await fetch("/api/agent-config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            preset: "custom",
            config: newConfig,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to update config: ${response.status}`);
        }

        const data: AgentConfigApiResponse = await response.json();

        if (data.success && data.config) {
          setConfig(data.config);
          setOriginalConfig(data.config);
          setHasUnsavedChanges(false);
          console.log("✅ Agent config updated:", data.config);
        } else {
          throw new Error(data.error || "Failed to update configuration");
        }
      } catch (err) {
        console.error("❌ Error updating agent config:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [config],
  );

  // Reset configuration to default
  const resetConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent-config", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to reset config: ${response.status}`);
      }

      const data: AgentConfigApiResponse = await response.json();

      if (data.success && data.config) {
        setConfig(data.config);
        setOriginalConfig(data.config);
        setHasUnsavedChanges(false);
        console.log("✅ Agent config reset to default");
      } else {
        throw new Error(data.error || "Failed to reset configuration");
      }
    } catch (err) {
      console.error("❌ Error resetting agent config:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Apply preset configuration
  const applyPreset = useCallback(
    async (presetName: keyof typeof PRESET_CONFIGS) => {
      if (!PRESET_CONFIGS[presetName]) {
        setError(`Invalid preset: ${presetName}`);
        return;
      }

      await updateConfig(PRESET_CONFIGS[presetName]);
    },
    [updateConfig],
  );

  // Check for unsaved changes
  useEffect(() => {
    if (config && originalConfig) {
      const hasChanges =
        JSON.stringify(config) !== JSON.stringify(originalConfig);
      setHasUnsavedChanges(hasChanges);
    }
  }, [config, originalConfig]);

  // Load configuration on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Temporary local update (for immediate UI feedback)
  const updateLocalConfig = useCallback(
    (updates: Partial<AgentExecutionConfig>) => {
      if (!config) return;

      const newConfig = { ...config, ...updates };
      setConfig(newConfig);

      // Check if this matches the original config
      const hasChanges = originalConfig
        ? JSON.stringify(newConfig) !== JSON.stringify(originalConfig)
        : true;
      setHasUnsavedChanges(hasChanges);
    },
    [config, originalConfig],
  );

  return {
    config,
    isLoading,
    error,
    updateConfig,
    resetConfig,
    loadConfig,
    presets: PRESET_CONFIGS,
    hasUnsavedChanges,
    // Additional utility methods
    applyPreset,
    updateLocalConfig,
  };
}

/**
 * Hook for quick parallel execution settings
 */
export function useParallelExecutionConfig() {
  const { config, updateConfig, updateLocalConfig, isLoading, error } =
    useAgentConfig();

  const isEnabled = config?.enableParallelExecution ?? false;
  const maxConcurrency = config?.maxConcurrency ?? 5;
  const timeout = config?.parallelTimeout ?? 30000;
  const fallback = config?.fallbackToSequential ?? true;

  const toggleParallelExecution = useCallback(
    async (enabled: boolean) => {
      await updateConfig({ enableParallelExecution: enabled });
    },
    [updateConfig],
  );

  const setConcurrency = useCallback(
    async (concurrency: number) => {
      if (concurrency >= 1 && concurrency <= 50) {
        await updateConfig({ maxConcurrency: concurrency });
      }
    },
    [updateConfig],
  );

  const setTimeout = useCallback(
    async (timeoutMs: number) => {
      if (timeoutMs >= 1000 && timeoutMs <= 300000) {
        await updateConfig({ parallelTimeout: timeoutMs });
      }
    },
    [updateConfig],
  );

  const toggleFallback = useCallback(
    async (enabled: boolean) => {
      await updateConfig({ fallbackToSequential: enabled });
    },
    [updateConfig],
  );

  // Local updates for immediate UI feedback
  const toggleParallelExecutionLocal = useCallback(
    (enabled: boolean) => {
      updateLocalConfig({ enableParallelExecution: enabled });
    },
    [updateLocalConfig],
  );

  const setConcurrencyLocal = useCallback(
    (concurrency: number) => {
      if (concurrency >= 1 && concurrency <= 50) {
        updateLocalConfig({ maxConcurrency: concurrency });
      }
    },
    [updateLocalConfig],
  );

  return {
    isEnabled,
    maxConcurrency,
    timeout,
    fallback,
    isLoading,
    error,
    toggleParallelExecution,
    setConcurrency,
    setTimeout,
    toggleFallback,
    // Local update methods for immediate UI feedback
    toggleParallelExecutionLocal,
    setConcurrencyLocal,
    // Access to full config
    fullConfig: config,
    updateFullConfig: updateConfig,
  };
}
