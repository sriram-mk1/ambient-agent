import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, Zap, Shield, Clock, ChevronDown } from "lucide-react";
import { AgentExecutionConfig } from "@/lib/agent-utils";

interface ParallelExecutionConfigProps {
  config: AgentExecutionConfig;
  onConfigChange: (config: Partial<AgentExecutionConfig>) => void;
  onSave: () => void;
  isLoading?: boolean;
}

const PRESET_CONFIGS = {
  conservative: {
    enableParallelExecution: false,
    maxConcurrency: 3,
    parallelTimeout: 20000,
    fallbackToSequential: true,
  },
  balanced: {
    enableParallelExecution: true,
    maxConcurrency: 5,
    parallelTimeout: 30000,
    fallbackToSequential: true,
  },
  aggressive: {
    enableParallelExecution: true,
    maxConcurrency: 10,
    parallelTimeout: 60000,
    fallbackToSequential: false,
  },
};

export function ParallelExecutionConfig({
  config,
  onConfigChange,
  onSave,
  isLoading = false,
}: ParallelExecutionConfigProps) {
  const [localConfig, setLocalConfig] = useState<AgentExecutionConfig>(config);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalConfig(config);
    setHasChanges(false);
  }, [config]);

  const handleConfigUpdate = (updates: Partial<AgentExecutionConfig>) => {
    const newConfig = { ...localConfig, ...updates };
    setLocalConfig(newConfig);
    setHasChanges(true);
    onConfigChange(updates);
  };

  const handlePresetSelect = (presetName: keyof typeof PRESET_CONFIGS) => {
    const presetConfig = PRESET_CONFIGS[presetName];
    handleConfigUpdate(presetConfig);
  };

  const handleSave = () => {
    onSave();
    setHasChanges(false);
  };

  const getStatusBadge = () => {
    if (!localConfig.enableParallelExecution) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600">
          <Shield className="w-3 h-3 mr-1" />
          Sequential Only
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-600">
        <Zap className="w-3 h-3 mr-1" />
        Parallel Enabled
      </span>
    );
  };

  return (
    <div className="space-y-6 p-4 border rounded-lg bg-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Zap className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Parallel Tool Execution</h3>
            <p className="text-sm text-gray-600">
              Configure how tools execute for better performance
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {/* Quick Presets */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Quick Presets</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-start gap-1">
              <span>Choose Preset</span>
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-full">
            <DropdownMenuItem
              className="pl-1"
              onClick={() => handlePresetSelect("conservative")}
            >
              <Shield className="w-4 h-4 mr-1" />
              <div>
                <div className="font-medium">Conservative</div>
                <div className="text-xs text-gray-500">
                  Sequential execution only, safer but slower
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem className="pl-1" onClick={() => handlePresetSelect("balanced")}>
              <Settings className="w-4 h-4 mr-1" />
              <div>
                <div className="font-medium">Balanced (Recommended)</div>
                <div className="text-xs text-gray-500">
                  Parallel for safe tools, sequential for sensitive
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem className="pl-1" onClick={() => handlePresetSelect("aggressive")}>
              <Zap className="w-4 h-4 mr-1" />
              <div>
                <div className="font-medium">Aggressive</div>
                <div className="text-xs text-gray-500">
                  Maximum parallelism, faster but less forgiving
                </div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main Toggle */}
      <div className="space-y-3">
        <div className="flex items-center space-x-3">
          <Checkbox
            id="enableParallel"
            checked={localConfig.enableParallelExecution}
            onCheckedChange={(checked) =>
              handleConfigUpdate({ enableParallelExecution: !!checked })
            }
          />
          <Label htmlFor="enableParallel" className="text-sm font-medium">
            Enable Parallel Tool Execution
          </Label>
        </div>
        <p className="text-xs text-gray-500 ml-6">
          Allow safe tools to run simultaneously for better performance.
          Sensitive tools will always require approval and run sequentially.
        </p>
      </div>

      {/* Advanced Settings */}
      {localConfig.enableParallelExecution && (
        <div className="space-y-4 border-t pt-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Advanced Settings
          </h4>

          {/* Max Concurrency */}
          <div className="space-y-2">
            <Label htmlFor="maxConcurrency" className="text-sm">
              Maximum Concurrent Tools
            </Label>
            <div className="flex items-center space-x-2">
              <Input
                id="maxConcurrency"
                type="number"
                min="1"
                max="20"
                value={localConfig.maxConcurrency}
                onChange={(e) =>
                  handleConfigUpdate({
                    maxConcurrency: parseInt(e.target.value) || 1,
                  })
                }
                className="w-20"
              />
              <span className="text-xs text-gray-500">
                tools at once (1-20)
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Higher values = faster execution but more resource usage
            </p>
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <Label htmlFor="parallelTimeout" className="text-sm">
              Tool Timeout
            </Label>
            <div className="flex items-center space-x-2">
              <Input
                id="parallelTimeout"
                type="number"
                min="5000"
                max="120000"
                step="5000"
                value={localConfig.parallelTimeout}
                onChange={(e) =>
                  handleConfigUpdate({
                    parallelTimeout: parseInt(e.target.value) || 30000,
                  })
                }
                className="w-24"
              />
              <span className="text-xs text-gray-500">
                ms ({Math.round(localConfig.parallelTimeout / 1000)}s)
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Maximum time to wait for each tool to complete
            </p>
          </div>

          {/* Fallback Option */}
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <Checkbox
                id="fallbackSequential"
                checked={localConfig.fallbackToSequential}
                onCheckedChange={(checked) =>
                  handleConfigUpdate({ fallbackToSequential: !!checked })
                }
              />
              <Label htmlFor="fallbackSequential" className="text-sm">
                Fallback to Sequential Execution
              </Label>
            </div>
            <p className="text-xs text-gray-500 ml-6">
              If parallel execution fails, automatically retry with sequential
              execution
            </p>
          </div>
        </div>
      )}

      {/* Performance Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <div className="p-1 bg-blue-100 rounded">
            <Zap className="w-3 h-3 text-blue-600" />
          </div>
          <div className="text-xs">
            <div className="font-medium text-blue-800 mb-1">
              Performance Impact
            </div>
            <div className="text-blue-700 space-y-1">
              {localConfig.enableParallelExecution ? (
                <>
                  <div>✅ 3-5x faster for multi-search operations</div>
                  <div>
                    ✅ Up to {localConfig.maxConcurrency} tools simultaneously
                  </div>
                  <div>
                    ✅ {Math.round(localConfig.parallelTimeout / 1000)}s timeout
                    per tool
                  </div>
                </>
              ) : (
                <>
                  <div>🛡️ Maximum safety - all tools run sequentially</div>
                  <div>🔒 Every tool requires individual approval</div>
                  <div>⏱️ Slower but more controlled execution</div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <div className="p-1 bg-amber-100 rounded">
            <Shield className="w-3 h-3 text-amber-600" />
          </div>
          <div className="text-xs">
            <div className="font-medium text-amber-800 mb-1">
              Security Guarantee
            </div>
            <div className="text-amber-700">
              Sensitive tools (email, delete, create, etc.) will{" "}
              <strong>always</strong> require your approval and run one at a
              time, regardless of parallel settings.
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setLocalConfig(config);
            setHasChanges(false);
          }}
          disabled={!hasChanges || isLoading}
        >
          Reset
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isLoading}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isLoading ? (
            <>
              <Clock className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Settings className="w-4 h-4 mr-2" />
              Save Configuration
            </>
          )}
        </Button>
      </div>

      {/* Quick Test Section */}
      {localConfig.enableParallelExecution && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2">Quick Test</h4>
          <p className="text-xs text-gray-600 mb-3">
            Try this command to test parallel execution:
          </p>
          <div className="bg-gray-100 p-2 rounded text-xs font-mono">
            Search my Gmail for "project updates", check today's calendar, and
            get the latest tech news
          </div>
          <p className="text-xs text-gray-500 mt-1">
            This should execute 3 searches in parallel if configured correctly.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for embedding in other components
 */
export function ParallelExecutionToggle({
  enabled,
  maxConcurrency,
  onToggle,
  onConcurrencyChange,
}: {
  enabled: boolean;
  maxConcurrency: number;
  onToggle: (enabled: boolean) => void;
  onConcurrencyChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between p-2 border rounded">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-medium">Parallel Execution</span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="1"
          max="20"
          value={maxConcurrency}
          onChange={(e) => onConcurrencyChange(parseInt(e.target.value) || 1)}
          className="w-16 h-8 text-xs"
          disabled={!enabled}
        />
        <Checkbox checked={enabled} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}
