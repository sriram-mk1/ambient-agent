"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ArrowUpDown, Search } from "lucide-react";
import { useConnectedApps } from "@/hooks/useConnectedApps";
import IntegrationDropdown from "@/components/integration-dropdown";
import {
  SiGmail,
  SiGooglesheets,
  SiGoogledocs,
  SiGooglecalendar,
  SiGoogledrive,
  SiAsana,
  SiSalesforce,
  SiHubspot,
  SiMailchimp,
  SiGithub,
  SiDropbox,
  SiJira,
  SiConfluence,
  SiLinkedin,
  SiSlack,
  SiStripe,
  SiNotion,
  SiLinear,
} from "react-icons/si";
import { FaGithub, FaXTwitter } from "react-icons/fa6";
import { useGoogleAuth } from "@/hooks/useGoogleAuth";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { cn } from "@/lib/utils";

// Animation variants
const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
    },
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: {
      duration: 0.2,
    },
  },
};

interface BaseIntegration {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  status: "Healthy" | "Issues" | "Not Connected" | "Coming Soon";
  lastChecked: string;
  connected: boolean;
  description: string;
  comingSoon: boolean;
  tools: number; // Number of tools available for the integration
}

interface Integration extends BaseIntegration {}

interface DBIntegration extends Omit<BaseIntegration, "tools"> {
  tools: number;
}

interface MasterIntegration
  extends Omit<
    Integration,
    "status" | "lastChecked" | "connected" | "description" | "tools"
  > {
  icon: React.ComponentType<{ className?: string }>;
  comingSoon: boolean;
}

const getToolCountForApp = (appId: string): number => {
  const toolCounts: Record<string, number> = {
    gmail: 9, // listEmails, getEmail, sendEmail, getInboxStats, markEmailAsRead, markEmailAsUnread, moveEmailToLabel, deleteEmail, listLabels
    calendar: 6, // listEvents, getEvent, createEvent, updateEvent, deleteEvent, listCalendars
    docs: 6, // listDocuments, getDocument, createDocument, insertText, updateDocument, deleteDocument
    sheets: 7, // listSpreadsheets, getSpreadsheet, createSpreadsheet, getValues, updateValues, appendValues, deleteSpreadsheet
    drive: 6, // listFiles, getFile, uploadFile, updateFile, deleteFile, searchFiles (placeholder counts)
  };
  return toolCounts[appId] || 0;
};

const MASTER_INTEGRATIONS: MasterIntegration[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: SiGmail,
    category: "Email",
    comingSoon: false,
  },
  {
    id: "sheets",
    name: "Google Sheets",
    icon: SiGooglesheets,
    category: "Productivity",
    comingSoon: false,
  },
  {
    id: "docs",
    name: "Google Docs",
    icon: SiGoogledocs,
    category: "Productivity",
    comingSoon: false,
  },
  {
    id: "calendar",
    name: "Google Calendar",
    icon: SiGooglecalendar,
    category: "Productivity",
    comingSoon: false,
  },
  {
    id: "drive",
    name: "Google Drive",
    icon: SiGoogledrive,
    category: "Productivity",
    comingSoon: false,
  },
  {
    id: "asana",
    name: "Asana",
    icon: SiAsana,
    category: "Project Management",
    comingSoon: true,
  },
  {
    id: "twitter",
    name: "X (Twitter)",
    icon: FaXTwitter,
    category: "Social Media",
    comingSoon: true,
  },
  {
    id: "salesforce",
    name: "Salesforce",
    icon: SiSalesforce,
    category: "CRM",
    comingSoon: true,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    icon: SiHubspot,
    category: "CRM",
    comingSoon: true,
  },
  {
    id: "mailchimp",
    name: "MailChimp",
    icon: SiMailchimp,
    category: "Marketing",
    comingSoon: true,
  },
  {
    id: "github",
    name: "GitHub",
    icon: FaGithub,
    category: "Development",
    comingSoon: true,
  },
  {
    id: "dropbox",
    name: "Dropbox",
    icon: SiDropbox,
    category: "Storage",
    comingSoon: true,
  },
  {
    id: "jira",
    name: "Jira",
    icon: SiJira,
    category: "Project Management",
    comingSoon: true,
  },
  {
    id: "confluence",
    name: "Confluence",
    icon: SiConfluence,
    category: "Documentation",
    comingSoon: true,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    icon: SiLinkedin,
    category: "Social",
    comingSoon: true,
  },
  {
    id: "slack",
    name: "Slack",
    icon: SiSlack,
    category: "Communication",
    comingSoon: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    icon: SiStripe,
    category: "Payments",
    comingSoon: true,
  },
  {
    id: "notion",
    name: "Notion",
    icon: SiNotion,
    category: "Productivity",
    comingSoon: true,
  },
  {
    id: "linear",
    name: "Linear",
    icon: SiLinear,
    category: "Project Management",
    comingSoon: true,
  },
];

export default function ConnectionsPage() {
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<
    "all" | "connected" | "not_connected" | "issues"
  >("all");
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  }>({ key: "name", direction: "asc" });
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);
  const { connectGoogleAccount, isLoading: isConnecting } = useGoogleAuth();
  const searchParams = useSearchParams();
  const {
    connectedApps,
    loading: loadingConnectedApps,
    refetch,
  } = useConnectedApps();

  // Merge connected apps data with master integrations
  useEffect(() => {
    if (loadingConnectedApps) return;

    const mergedIntegrations = MASTER_INTEGRATIONS.map((master) => {
      const connectedApp = connectedApps.find((app) => app.app === master.id);
      const isConnected = !!connectedApp;
      const needsReconnection = connectedApp?.needsReconnection || false;
      const status: "Coming Soon" | "Healthy" | "Not Connected" =
        master.comingSoon
          ? "Coming Soon"
          : isConnected
            ? "Healthy"
            : "Not Connected";

      return {
        ...master,
        status,
        lastChecked: isConnected ? new Date().toISOString() : "",
        connected: isConnected,
        description: isConnected
          ? `Connected to ${master.name}`
          : `Connect your ${master.name} account`,
        tools: isConnected
          ? connectedApp?.tools?.length || getToolCountForApp(master.id)
          : 0,
        comingSoon: master.comingSoon,
      };
    });

    setIntegrations(mergedIntegrations);
    setLoading(false);
  }, [connectedApps, loadingConnectedApps]);

  // Memoize connected app data to prevent unnecessary re-renders
  const connectedAppDataMap = useMemo(() => {
    const map = new Map<string, { description: string; tools: string[] }>();
    connectedApps.forEach((connectedApp) => {
      map.set(connectedApp.app, {
        description: connectedApp.description || "",
        tools: connectedApp.tools || [],
      });
    });
    return map;
  }, [connectedApps]);

  // Handle OAuth callback result
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const app = searchParams.get("app");

    if (success && app) {
      // The useConnectedApps hook will automatically refetch
      console.log(`Successfully connected ${app}`);
    }

    if (error) {
      console.error("OAuth Error:", error);
      // You might want to show a toast or notification here
    }
  }, [searchParams]);

  // Handle update integration
  const handleUpdate = async (
    appId: string,
    description: string,
    tools: string[],
  ) => {
    console.log("🔄 [CONNECTIONS PAGE] Starting update for:", {
      appId,
      description,
      toolsCount: tools.length,
    });
    setIsUpdating(appId);

    try {
      const response = await fetch("/api/integrations/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app: appId,
          description,
          tools,
        }),
      });

      const result = await response.json();
      console.log("🔄 [CONNECTIONS PAGE] Update response:", {
        success: response.ok,
        result,
      });

      if (response.ok) {
        console.log(
          "✅ [CONNECTIONS PAGE] Integration updated successfully:",
          result,
        );

        // Refetch the connected apps to update the UI
        await refetch();

        return { success: true, message: "Integration updated successfully" };
      } else {
        console.error(
          "❌ [CONNECTIONS PAGE] Failed to update integration:",
          result.error,
        );
        return { success: false, error: result.error || "Unknown error" };
      }
    } catch (error) {
      console.error("❌ [CONNECTIONS PAGE] Error updating integration:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      setIsUpdating(null);
    }
  };

  // Handle revoke integration
  const handleRevoke = async (appId: string, appName: string) => {
    console.log("🔄 [CONNECTIONS PAGE] Starting revoke for:", {
      appId,
      appName,
    });

    const confirmRevoke = confirm(
      `Are you sure you want to revoke access to ${appName}? This will disconnect the integration and you'll need to reconnect it later.`,
    );
    if (!confirmRevoke) {
      console.log("❌ [CONNECTIONS PAGE] User cancelled revoke for:", appId);
      return { success: false, error: "User cancelled" };
    }

    setIsRevoking(appId);

    try {
      const response = await fetch("/api/integrations/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app: appId,
        }),
      });

      const result = await response.json();
      console.log("🔄 [CONNECTIONS PAGE] Revoke response:", {
        success: response.ok,
        result,
      });

      if (response.ok) {
        console.log(
          "✅ [CONNECTIONS PAGE] Integration revoked successfully:",
          result,
        );
        // Refetch the connected apps to update the UI
        await refetch();
        // Also close the expanded row since the integration is now disconnected
        if (expandedRow === appId) {
          setExpandedRow(null);
        }
        return { success: true, message: "Integration revoked successfully" };
      } else {
        console.error(
          "❌ [CONNECTIONS PAGE] Failed to revoke integration:",
          result.error,
        );
        return { success: false, error: result.error || "Unknown error" };
      }
    } catch (error) {
      console.error("❌ [CONNECTIONS PAGE] Error revoking integration:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      setIsRevoking(null);
    }
  };

  const handleRowClick = (id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  // Always show all integrations, even if not connected
  const filteredIntegrations = (integrations as Integration[]).filter(
    (integration) => {
      if (filter === "connected" && !integration.connected) return false;
      if (filter === "not_connected" && integration.connected) return false;
      if (filter === "issues" && integration.status !== "Issues") return false;
      if (
        searchQuery &&
        !integration.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    },
  );

  const sortedIntegrations = [...filteredIntegrations].sort((a, b) => {
    // Push coming soon items to the bottom
    if (a.comingSoon && !b.comingSoon) return 1;
    if (!a.comingSoon && b.comingSoon) return -1;

    // Then show connected apps
    if (a.connected && !b.connected) return -1;
    if (!a.connected && b.connected) return 1;

    // Then sort by the selected column
    const aValue = a[sortConfig.key as keyof typeof a];
    const bValue = b[sortConfig.key as keyof typeof b];

    // Handle undefined values
    if (aValue === undefined && bValue === undefined) return 0;
    if (aValue === undefined) return sortConfig.direction === "asc" ? 1 : -1;
    if (bValue === undefined) return sortConfig.direction === "asc" ? -1 : 1;

    // Safe comparison for strings, numbers, and Dates
    const aStr = String(aValue);
    const bStr = String(bValue);

    if (aStr < bStr) {
      return sortConfig.direction === "asc" ? -1 : 1;
    }
    if (aStr > bStr) {
      return sortConfig.direction === "asc" ? 1 : -1;
    }
    return 0;
  });

  const requestSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Fixed Header */}
      <div className="px-8 pt-8 pb-4 bg-white border-b border-gray-200">
        <div className="mb-2 pl-2">
          <h1
            className="text-2xl font-normal text-gray-900"
            style={{ fontFamily: "var(--font-merriweather), serif" }}
          >
            Connections
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your app integrations and connections
          </p>
        </div>

        <div className="mt-6 pl-2 flex items-center justify-between gap-3">
          <div className="relative max-w-lg w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search integrations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:ring-0 focus:ring-offset-0 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
          {/* Connections Table */}
          <div className="bg-white rounded border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-12 items-center gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="col-span-3">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider"
                  onClick={() => requestSort("name")}
                >
                  Integration
                  <ArrowUpDown className="h-3.5 w-3.5 ml-1" />
                </button>
              </div>
              <div className="col-span-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </span>
              </div>
              <div className="col-span-2">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider"
                  onClick={() => requestSort("status")}
                >
                  Status
                  <ArrowUpDown className="h-3.5 w-3.5 ml-1" />
                </button>
              </div>
              <div className="col-span-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tools
                </span>
              </div>
              <div className="col-span-3"></div>
            </div>

            {/* Table Body */}
            <motion.div
              className="divide-y divide-gray-100"
              variants={container}
              initial="hidden"
              animate="show"
            >
              <AnimatePresence>
                {sortedIntegrations.length > 0 ? (
                  sortedIntegrations.map((integration) => (
                    <React.Fragment key={integration.id}>
                      <motion.div
                        onClick={() =>
                          integration.connected &&
                          handleRowClick(integration.id)
                        }
                        className={`group grid cursor-pointer grid-cols-12 items-center gap-3 px-4 py-3 ${expandedRow === integration.id ? "bg-gray-50" : "hover:bg-gray-50"}`}
                        style={{
                          borderBottom:
                            expandedRow === integration.id
                              ? "1px solid transparent"
                              : "1px solid #f3f4f6",
                        }}
                        variants={item}
                        whileHover={{ x: 1 }}
                      >
                        <div className="col-span-3 flex items-center gap-2.5">
                          <div
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded flex-shrink-0",
                              integration.connected
                                ? "bg-blue-50 text-blue-600"
                                : "bg-gray-100 text-gray-500",
                            )}
                          >
                            <integration.icon
                              className={cn(
                                "h-3.5 w-3.5",
                                integration.id === "github" ? "scale-125" : "",
                              )}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-gray-900 group-hover:text-blue-600">
                                {integration.name}
                              </span>
                              {integration.connected && (
                                <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                  Connected
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-gray-500">
                              {integration.description}
                            </p>
                          </div>
                        </div>
                        <div className="col-span-2">
                          <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                            {integration.category}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span
                            className={cn(
                              "text-xs font-medium uppercase tracking-wider opacity-60",
                              integration.status === "Healthy"
                                ? "text-green-600"
                                : integration.status === "Not Connected"
                                  ? "text-red-500"
                                  : integration.status === "Coming Soon"
                                    ? "text-gray-500"
                                    : "text-yellow-600",
                            )}
                          >
                            {integration.status}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-xs font-medium text-gray-700">
                            {integration.tools} tools
                          </span>
                        </div>
                        <div className="col-span-3 flex justify-end items-center pr-1">
                          {integration.connected ? (
                            <button className="flex items-center gap-0.5 text-xs font-medium text-green-600 hover:text-green-700 bg-green-50/50 hover:bg-green-100/50 px-3 py-1.5 rounded-sm min-w-[80px] justify-between">
                              <span>Manage</span>
                              <ChevronRight
                                className={`h-3 w-3 text-green-500 transition-transform ${expandedRow === integration.id ? "rotate-90" : ""}`}
                              />
                            </button>
                          ) : integration.comingSoon ? (
                            <></>
                          ) : (
                            <button
                              onClick={() =>
                                connectGoogleAccount(integration.id)
                              }
                              disabled={isConnecting}
                              className={`text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50/50 hover:bg-blue-100/50 px-2.5 py-1 rounded-sm ${
                                isConnecting
                                  ? "opacity-50 cursor-not-allowed"
                                  : ""
                              }`}
                            >
                              {isConnecting ? "Connecting..." : "Connect"}
                            </button>
                          )}
                        </div>
                      </motion.div>
                      <AnimatePresence>
                        {expandedRow === integration.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: "easeInOut" }}
                            className="col-span-12 bg-white border-b border-gray-200"
                          >
                            <IntegrationDropdown
                              key={integration.id}
                              integration={integration}
                              onUpdate={handleUpdate}
                              onRevoke={handleRevoke}
                              isUpdating={isUpdating === integration.id}
                              isRevoking={isRevoking === integration.id}
                              onRefresh={refetch}
                              connectedAppData={connectedAppDataMap.get(
                                integration.id,
                              )}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))
                ) : (
                  <div className="py-12 text-center">
                    <p className="text-gray-500">
                      No integrations found. Try adjusting your search or
                      filters.
                    </p>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
