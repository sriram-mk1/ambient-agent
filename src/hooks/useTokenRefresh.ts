import { useState, useCallback } from 'react';

interface TokenRefreshResult {
  success: boolean;
  refreshedApps: string[];
  failedApps: string[];
  connectionStatus: {
    userId: string;
    connectedApps: string[];
    expiredApps: string[];
    failedApps: string[];
    needsReconnection: boolean;
    lastChecked: string;
  };
  cacheCleared?: boolean;
  timestamp: string;
}

interface TokenStatus {
  userId: string;
  connectionStatus: {
    userId: string;
    connectedApps: string[];
    expiredApps: string[];
    failedApps: string[];
    needsReconnection: boolean;
    lastChecked: string;
  };
  timestamp: string;
}

export const useTokenRefresh = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshResult, setLastRefreshResult] = useState<TokenRefreshResult | null>(null);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);

  // Check token status
  const checkTokenStatus = useCallback(async () => {
    try {
      setIsCheckingStatus(true);
      setError(null);

      const response = await fetch('/api/tokens/refresh');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check token status');
      }

      setTokenStatus(data);
      return data as TokenStatus;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check token status';
      setError(errorMessage);
      console.error('❌ Token status check failed:', err);
      throw err;
    } finally {
      setIsCheckingStatus(false);
    }
  }, []);

  // Refresh tokens
  const refreshTokens = useCallback(async (force = false) => {
    try {
      setIsRefreshing(true);
      setError(null);

      const response = await fetch('/api/tokens/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh tokens');
      }

      setLastRefreshResult(data);

      // Update token status with the latest info
      if (data.connectionStatus) {
        setTokenStatus({
          userId: data.userId,
          connectionStatus: data.connectionStatus,
          timestamp: data.timestamp,
        });
      }

      console.log('✅ Token refresh completed:', {
        refreshed: data.refreshedApps,
        failed: data.failedApps,
        cacheCleared: data.cacheCleared,
      });

      return data as TokenRefreshResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh tokens';
      setError(errorMessage);
      console.error('❌ Token refresh failed:', err);
      throw err;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Force refresh tokens (bypass expiry checks)
  const forceRefreshTokens = useCallback(async () => {
    return refreshTokens(true);
  }, [refreshTokens]);

  // Check if user needs to reconnect any apps
  const needsReconnection = useCallback(() => {
    return tokenStatus?.connectionStatus?.needsReconnection || false;
  }, [tokenStatus]);

  // Get apps that need reconnection
  const getAppsNeedingReconnection = useCallback(() => {
    if (!tokenStatus?.connectionStatus) return [];

    return [
      ...tokenStatus.connectionStatus.expiredApps,
      ...tokenStatus.connectionStatus.failedApps,
    ];
  }, [tokenStatus]);

  // Get successfully connected apps
  const getConnectedApps = useCallback(() => {
    return tokenStatus?.connectionStatus?.connectedApps || [];
  }, [tokenStatus]);

  // Clear error state
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Get summary of last refresh
  const getLastRefreshSummary = useCallback(() => {
    if (!lastRefreshResult) return null;

    return {
      success: lastRefreshResult.success,
      totalRefreshed: lastRefreshResult.refreshedApps.length,
      totalFailed: lastRefreshResult.failedApps.length,
      refreshedApps: lastRefreshResult.refreshedApps,
      failedApps: lastRefreshResult.failedApps,
      cacheCleared: lastRefreshResult.cacheCleared || false,
      timestamp: lastRefreshResult.timestamp,
    };
  }, [lastRefreshResult]);

  return {
    // State
    isRefreshing,
    isCheckingStatus,
    error,
    tokenStatus,
    lastRefreshResult,

    // Actions
    checkTokenStatus,
    refreshTokens,
    forceRefreshTokens,
    clearError,

    // Computed values
    needsReconnection: needsReconnection(),
    appsNeedingReconnection: getAppsNeedingReconnection(),
    connectedApps: getConnectedApps(),
    lastRefreshSummary: getLastRefreshSummary(),

    // Helper methods
    getAppsNeedingReconnection,
    getConnectedApps,
    getLastRefreshSummary,
  };
};
