import { useState, useEffect } from "react";

export interface ConnectedApp {
  app: string;
  created_at: string;
  description: string;
  tools: string[];
  hasValidToken: boolean;
  tokenExpired: boolean;
  needsReconnection: boolean;
}

export function useConnectedApps() {
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnectedApps = async () => {
    try {
      console.log("🔄 [USE_CONNECTED_APPS] Starting fetchConnectedApps...");
      setLoading(true);
      const response = await fetch("/api/integrations/connected-apps");

      if (!response.ok) {
        throw new Error("Failed to fetch connected apps");
      }

      const data = await response.json();
      console.log("📊 [USE_CONNECTED_APPS] API response received:", {
        totalCount: data.totalCount,
        connectedAppsCount: data.connectedApps?.length || 0,
        apps:
          data.connectedApps?.map((app: ConnectedApp) => ({
            app: app.app,
            description: app.description,
            toolsCount: app.tools.length,
          })) || [],
      });

      setConnectedApps(data.connectedApps || []);
      console.log(
        "✅ [USE_CONNECTED_APPS] State updated with new connected apps",
      );
    } catch (err) {
      console.error(
        "❌ [USE_CONNECTED_APPS] Error fetching connected apps:",
        err,
      );
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectedApps();
  }, []);

  return {
    connectedApps,
    loading,
    error,
    refetch: fetchConnectedApps,
  };
}
