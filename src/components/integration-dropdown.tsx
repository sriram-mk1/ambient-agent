import React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";

interface Integration {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  status: "Healthy" | "Issues" | "Not Connected" | "Coming Soon";
  lastChecked: string;
  connected: boolean;
  description: string;
  tools: number | string[];
  comingSoon: boolean;
}

interface IntegrationDropdownProps {
  integration: Integration;
  onUpdate: (
    appId: string,
    description: string,
    tools: string[],
  ) => Promise<{ success: boolean; error?: string; message?: string }>;
  onRevoke: (
    appId: string,
    appName: string,
  ) => Promise<{ success: boolean; error?: string; message?: string }>;
  isUpdating: boolean;
  isRevoking: boolean;
  onRefresh?: () => void;
  connectedAppData?: {
    description: string;
    tools: string[];
  };
}

const getToolsForApp = (appId: string) => {
  const toolsMap: Record<
    string,
    Array<{ id: string; label: string; description: string }>
  > = {
    gmail: [
      {
        id: "listEmails",
        label: "listEmails",
        description: "Retrieve a list of emails from Gmail with search support",
      },
      {
        id: "getEmail",
        label: "getEmail",
        description: "Get full details of a specific email by message ID",
      },
      {
        id: "sendEmail",
        label: "sendEmail",
        description: "Send an email through Gmail",
      },
      {
        id: "getInboxStats",
        label: "getInboxStats",
        description: "Get Gmail inbox statistics and counts",
      },
      {
        id: "markEmailAsRead",
        label: "markEmailAsRead",
        description: "Mark a specific email as read",
      },
      {
        id: "markEmailAsUnread",
        label: "markEmailAsUnread",
        description: "Mark a specific email as unread",
      },
      {
        id: "moveEmailToLabel",
        label: "moveEmailToLabel",
        description: "Move an email to a specified label",
      },
      {
        id: "deleteEmail",
        label: "deleteEmail",
        description: "Delete an email by moving it to trash",
      },
      {
        id: "listLabels",
        label: "listLabels",
        description: "Get a list of all Gmail labels",
      },
    ],
    calendar: [
      {
        id: "listEvents",
        label: "listEvents",
        description: "Retrieve calendar events with time filtering",
      },
      {
        id: "getEvent",
        label: "getEvent",
        description: "Get full details of a specific calendar event",
      },
      {
        id: "createEvent",
        label: "createEvent",
        description: "Create a new calendar event",
      },
      {
        id: "updateEvent",
        label: "updateEvent",
        description: "Update an existing calendar event",
      },
      {
        id: "deleteEvent",
        label: "deleteEvent",
        description: "Delete a calendar event",
      },
      {
        id: "listCalendars",
        label: "listCalendars",
        description: "Get a list of all user calendars",
      },
    ],
    docs: [
      {
        id: "listDocuments",
        label: "listDocuments",
        description: "Retrieve a list of Google Docs with search support",
      },
      {
        id: "getDocument",
        label: "getDocument",
        description: "Get the full content of a Google Docs document",
      },
      {
        id: "createDocument",
        label: "createDocument",
        description: "Create a new Google Docs document",
      },
      {
        id: "insertText",
        label: "insertText",
        description: "Insert text into a document at specified position",
      },
      {
        id: "updateDocument",
        label: "updateDocument",
        description: "Apply batch updates to a Google Docs document",
      },
      {
        id: "deleteDocument",
        label: "deleteDocument",
        description: "Delete a Google Docs document",
      },
    ],
    sheets: [
      {
        id: "listSpreadsheets",
        label: "listSpreadsheets",
        description: "Retrieve a list of Google Sheets with search support",
      },
      {
        id: "getSpreadsheet",
        label: "getSpreadsheet",
        description: "Get information about a specific spreadsheet",
      },
      {
        id: "createSpreadsheet",
        label: "createSpreadsheet",
        description: "Create a new Google Sheets spreadsheet",
      },
      {
        id: "getValues",
        label: "getValues",
        description: "Read values from a specific range in a spreadsheet",
      },
      {
        id: "updateValues",
        label: "updateValues",
        description: "Update values in a specific range",
      },
      {
        id: "appendValues",
        label: "appendValues",
        description: "Append values to a spreadsheet",
      },
      {
        id: "deleteSpreadsheet",
        label: "deleteSpreadsheet",
        description: "Delete a Google Sheets spreadsheet",
      },
    ],
    drive: [
      { id: "listFiles", label: "listFiles", description: "List files in Google Drive with search and pagination" },
      { id: "getFile", label: "getFile", description: "Get file metadata and download URL" },
      { id: "uploadFile", label: "uploadFile", description: "Upload a new file to Google Drive" },
      { id: "updateFile", label: "updateFile", description: "Update an existing file's metadata or content" },
      { id: "deleteFile", label: "deleteFile", description: "Delete a file from Google Drive" },
      { id: "searchFiles", label: "searchFiles", description: "Search files by name, type, or content (if enabled)" },
    ],
  };
  return toolsMap[appId] || [];
};

const IntegrationDropdown: React.FC<IntegrationDropdownProps> = ({
  integration,
  onUpdate,
  onRevoke,
  isUpdating,
  isRevoking,
  onRefresh,
  connectedAppData,
}) => {
  // Get tools for this specific app
  const availableTools = getToolsForApp(integration.id);

  const [lastSaved, setLastSaved] = useState<string>("");
  const [dots, setDots] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const initializedIntegrationId = useRef<string | null>(null);

  // Initialize data from props (from database via useConnectedApps hook)
  // Only initialize once per integration to prevent form state reset
  useEffect(() => {
    if (integration.id !== initializedIntegrationId.current) {
      if (connectedAppData) {
        setDescription(connectedAppData.description || "");
        setSelectedTools(
          Array.isArray(connectedAppData.tools) &&
            connectedAppData.tools.length > 0
            ? connectedAppData.tools
            : availableTools.map((tool) => tool.id),
        );
      } else {
        // Default to all tools if no connected app data
        setSelectedTools(availableTools.map((tool) => tool.id));
      }
      initializedIntegrationId.current = integration.id;
    }
  }, [integration.id, connectedAppData, availableTools]);

  // Animate dots during updating
  useEffect(() => {
    if (isUpdating) {
      const timer = setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
      }, 300);
      return () => clearInterval(timer);
    }
  }, [isUpdating]);

  const handleUpdate = async () => {
    console.log("🔄 [DROPDOWN] Update button clicked for:", integration.id);
    console.log("🔄 [DROPDOWN] Description:", description);
    console.log("🔄 [DROPDOWN] Selected tools:", selectedTools);

    try {
      const result = await onUpdate(integration.id, description, selectedTools);
      console.log("🔄 [DROPDOWN] Update result:", result);

      if (result.success) {
        const now = new Date();
        const formattedTime = now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        setLastSaved(`Last saved at ${formattedTime}`);
        console.log("✅ [DROPDOWN] Integration updated successfully");

        // Trigger parent refresh to reload data
        if (onRefresh) {
          onRefresh();
        }
      } else {
        console.error(
          "❌ [DROPDOWN] Failed to update integration:",
          result.error,
        );
        alert(
          `Failed to update integration: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      console.error("❌ [DROPDOWN] Error calling update handler:", error);
      alert(
        `Error updating integration: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleRevoke = async () => {
    console.log("🔄 [DROPDOWN] Revoke button clicked for:", integration.id);

    try {
      const result = await onRevoke(integration.id, integration.name);
      console.log("🔄 [DROPDOWN] Revoke result:", result);

      if (result.success) {
        console.log("✅ [DROPDOWN] Integration revoked successfully");
      } else {
        console.error(
          "❌ [DROPDOWN] Failed to revoke integration:",
          result.error,
        );
        alert(
          `Failed to revoke integration: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      console.error("❌ [DROPDOWN] Error calling revoke handler:", error);
      alert(
        `Error revoking integration: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleToolChange = (toolId: string, checked: boolean) => {
    setSelectedTools((prev) =>
      checked ? [...prev, toolId] : prev.filter((t) => t !== toolId),
    );
  };

  return (
    <div className="p-6 bg-white">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Column */}
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg",
                  integration.connected
                    ? "bg-blue-50 text-blue-600"
                    : "bg-gray-100 text-gray-500",
                )}
              >
                <integration.icon className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-normal text-gray-900">
                  {integration.name}
                </h3>
                {lastSaved && !isUpdating && (
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
                    {lastSaved}
                  </span>
                )}
                {isUpdating && (
                  <span className="text-xs text-gray-500">Saving{dots}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs rounded-sm border-blue-500 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                onClick={handleUpdate}
                disabled={isUpdating}
              >
                {isUpdating ? "Updating..." : "Update"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs rounded-sm text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
                onClick={handleRevoke}
                disabled={isRevoking}
              >
                {isRevoking ? "Revoking..." : "Revoke"}
              </Button>
            </div>
          </div>

          <div className="mt-6">
            <h4
              className="font-medium text-gray-800 text-sm"
              style={{ fontFamily: "var(--font-merriweather), serif" }}
            >
              Integration Description
            </h4>
            <p className="text-xs text-gray-500 mt-1">
              This helps LLMs know when to use these tools.
            </p>
            <Textarea
              id="description"
              rows={4}
              className="w-full text-sm resize-none mt-2 min-h-[120px]"
              placeholder="Enter integration description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* Right Column */}
        <div>
          <h4
            className="font-medium text-gray-800 text-sm"
            style={{ fontFamily: "var(--font-merriweather), serif" }}
          >
            Select Tools
          </h4>
          <p className="text-xs text-gray-500 mt-1">
            Only selected tools will be available to be used in this team's
            endpoints. We recommend configuring general security permissions for
            this token through {integration.name}.
          </p>
          <div className="mt-3 space-y-2 rounded-md border border-gray-200 bg-gray-50/50 p-3">
            {availableTools.map((tool) => (
              <div
                key={tool.id}
                className="flex items-start gap-3 p-3 rounded-md bg-white border border-gray-200/75 shadow-sm"
              >
                <Checkbox
                  id={tool.id}
                  className="mt-0.5 data-[state=checked]:bg-[#FF7A00] data-[state=checked]:border-[#FF7A00]"
                  checked={selectedTools.includes(tool.id)}
                  onCheckedChange={(checked) =>
                    handleToolChange(tool.id, !!checked)
                  }
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor={tool.id}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {tool.label}
                  </label>
                  <p className="text-xs text-gray-500">{tool.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntegrationDropdown;
