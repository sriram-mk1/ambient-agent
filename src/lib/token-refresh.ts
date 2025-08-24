import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";

interface TokenRefreshResult {
  success: boolean;
  accessToken?: string;
  expiresAt?: string;
  error?: string;
}

interface UserConnectionStatus {
  userId: string;
  connectedApps: string[];
  expiredApps: string[];
  failedApps: string[];
  needsReconnection: boolean;
  lastChecked: string;
}

class TokenRefreshManager {
  private static instance: TokenRefreshManager;
  private refreshPromises = new Map<string, Promise<TokenRefreshResult>>();

  private constructor() {}

  static getInstance(): TokenRefreshManager {
    if (!TokenRefreshManager.instance) {
      TokenRefreshManager.instance = new TokenRefreshManager();
    }
    return TokenRefreshManager.instance;
  }

  /**
   * Check if a token is expired (with 5 minute buffer)
   */
  private isTokenExpired(expiresAt: string): boolean {
    if (!expiresAt) return true;

    const expiryTime = new Date(expiresAt).getTime();
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

    return now >= expiryTime - bufferTime;
  }

  /**
   * Refresh a single token using Google OAuth
   */
  private async refreshGoogleToken(
    refreshToken: string,
    app: string,
  ): Promise<TokenRefreshResult> {
    try {
      console.log(`🔄 Refreshing token for ${app}...`);

      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error("Missing Google OAuth credentials");
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );

      // Set the refresh token
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      // Refresh the access token
      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error("No access token received from refresh");
      }

      console.log(`✅ Successfully refreshed token for ${app}`);

      return {
        success: true,
        accessToken: credentials.access_token,
        expiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString(), // Default 1 hour
      };
    } catch (error: any) {
      console.error(`❌ Failed to refresh token for ${app}:`, error);

      // Check for specific invalid_grant error (more comprehensive)
      const errorStr = JSON.stringify(error);
      const errorMessage =
        error.message || error.error || error.error_description || "";
      const isInvalidGrant =
        errorMessage.includes("invalid_grant") ||
        errorStr.includes("invalid_grant") ||
        error.code === 400 ||
        error.status === 400;

      if (isInvalidGrant) {
        console.error(
          `🚫 Invalid grant for ${app} - refresh token is expired/revoked, will clear tokens`,
        );
        return {
          success: false,
          error: "invalid_grant",
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Token refresh failed",
      };
    }
  }

  /**
   * Update token in database
   */
  private async updateTokenInDatabase(
    userId: string,
    app: string,
    accessToken: string,
    expiresAt: string,
  ): Promise<boolean> {
    try {
      const supabase = await createClient();

      const { error } = await supabase
        .from("user_integrations")
        .update({
          access_token: accessToken,
          expires_at: expiresAt,
          last_updated: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("app", app)
        .eq("provider", "google");

      if (error) {
        console.error(
          `❌ Failed to update token in database for ${app}:`,
          error,
        );
        return false;
      }

      console.log(`✅ Updated token in database for ${app}`);
      return true;
    } catch (error) {
      console.error(`❌ Database error updating token for ${app}:`, error);
      return false;
    }
  }

  /**
   * Mark token as invalid in database (for invalid_grant errors)
   */
  private async markTokenAsInvalid(
    userId: string,
    app: string,
  ): Promise<boolean> {
    try {
      const supabase = await createClient();

      console.log(
        `🗑️ Clearing invalid tokens for ${app} - refresh token expired/revoked`,
      );

      // Clear all token data and mark as disconnected
      const { error } = await supabase
        .from("user_integrations")
        .delete()
        .eq("user_id", userId)
        .eq("app", app)
        .eq("provider", "google");

      if (error) {
        console.error(`❌ Failed to clear invalid tokens for ${app}:`, error);
        return false;
      }

      console.log(
        `✅ Cleared invalid tokens for ${app} - integration will appear as disconnected`,
      );
      return true;
    } catch (error) {
      console.error(
        `❌ Database error clearing invalid tokens for ${app}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Refresh token for a specific user and app
   */
  async refreshTokenForApp(
    userId: string,
    app: string,
    refreshToken: string,
  ): Promise<TokenRefreshResult> {
    const cacheKey = `${userId}_${app}`;

    // Check if refresh is already in progress
    if (this.refreshPromises.has(cacheKey)) {
      console.log(
        `⏳ Token refresh already in progress for ${app}, waiting...`,
      );
      return this.refreshPromises.get(cacheKey)!;
    }

    // Start refresh process
    const refreshPromise = this.performTokenRefresh(userId, app, refreshToken);
    this.refreshPromises.set(cacheKey, refreshPromise);

    try {
      const result = await refreshPromise;
      return result;
    } finally {
      // Clean up promise from cache
      this.refreshPromises.delete(cacheKey);
    }
  }

  /**
   * Perform the actual token refresh
   */
  private async performTokenRefresh(
    userId: string,
    app: string,
    refreshToken: string,
  ): Promise<TokenRefreshResult> {
    // Try to refresh the token
    const refreshResult = await this.refreshGoogleToken(refreshToken, app);

    if (!refreshResult.success) {
      // Handle invalid_grant specifically by clearing tokens
      if (refreshResult.error === "invalid_grant") {
        console.log(`🗑️ Clearing expired tokens for ${app}`);
        await this.markTokenAsInvalid(userId, app);
        return {
          success: false,
          error: "invalid_grant_cleared",
        };
      }
      return refreshResult;
    }

    // Update database with new token
    const updateSuccess = await this.updateTokenInDatabase(
      userId,
      app,
      refreshResult.accessToken!,
      refreshResult.expiresAt!,
    );

    if (!updateSuccess) {
      return {
        success: false,
        error: "Failed to update token in database",
      };
    }

    return refreshResult;
  }

  /**
   * Check and refresh all expired tokens for a user
   */
  async refreshExpiredTokensForUser(userId: string): Promise<{
    refreshedApps: string[];
    failedApps: string[];
    errors: Record<string, string>;
  }> {
    console.log(
      `🔄 Checking and refreshing expired tokens for user: ${userId}`,
    );

    const supabase = await createClient();

    // Get all integrations for the user
    const { data: integrations, error } = await supabase
      .from("user_integrations")
      .select("app, access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("provider", "google");

    if (error || !integrations) {
      console.error("❌ Failed to fetch user integrations:", error);
      return { refreshedApps: [], failedApps: [], errors: {} };
    }

    const refreshedApps: string[] = [];
    const failedApps: string[] = [];
    const errors: Record<string, string> = {};

    // Process each integration
    for (const integration of integrations) {
      const { app, expires_at, refresh_token } = integration;

      if (!refresh_token) {
        console.log(`⚠️ No refresh token for ${app}, skipping`);
        continue;
      }

      // Check if token is expired
      if (!this.isTokenExpired(expires_at)) {
        console.log(`✅ Token for ${app} is still valid`);
        continue;
      }

      console.log(`🔄 Token for ${app} is expired, refreshing...`);

      // Refresh the token
      const result = await this.refreshTokenForApp(userId, app, refresh_token);

      if (result.success) {
        refreshedApps.push(app);
        console.log(`✅ Successfully refreshed token for ${app}`);
      } else {
        failedApps.push(app);
        errors[app] = result.error || "Unknown error";

        // Handle cleared tokens differently from other errors
        if (result.error === "invalid_grant_cleared") {
          console.log(
            `🗑️ Cleared expired tokens for ${app} - now appears disconnected`,
          );
        } else {
          console.error(
            `❌ Failed to refresh token for ${app}: ${result.error}`,
          );
        }
      }
    }

    console.log(
      `🔄 Token refresh complete. Refreshed: ${refreshedApps.length}, Failed: ${failedApps.length}`,
    );

    if (failedApps.length > 0) {
      console.log(
        `⚠️ Post-message refresh: Failed for ${failedApps.join(", ")}`,
      );
    }

    return { refreshedApps, failedApps, errors };
  }

  /**
   * Check user connection status and identify apps that need attention
   */
  async checkUserConnectionStatus(
    userId: string,
  ): Promise<UserConnectionStatus> {
    const supabase = await createClient();

    const { data: integrations, error } = await supabase
      .from("user_integrations")
      .select("app, access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("provider", "google");

    const status: UserConnectionStatus = {
      userId,
      connectedApps: [],
      expiredApps: [],
      failedApps: [],
      needsReconnection: false,
      lastChecked: new Date().toISOString(),
    };

    if (error || !integrations) {
      console.error("❌ Failed to check user connections:", error);
      return status;
    }

    for (const integration of integrations) {
      const { app, access_token, refresh_token, expires_at } = integration;

      if (!access_token && !refresh_token) {
        status.failedApps.push(app);
        continue;
      }

      if (this.isTokenExpired(expires_at)) {
        if (refresh_token) {
          status.expiredApps.push(app);
        } else {
          status.failedApps.push(app);
        }
      } else {
        status.connectedApps.push(app);
      }
    }

    status.needsReconnection =
      status.failedApps.length > 0 || status.expiredApps.length > 0;

    return status;
  }

  /**
   * Get fresh token for a specific app (refresh if needed)
   */
  async getFreshToken(userId: string, app: string): Promise<string | null> {
    const supabase = await createClient();

    const { data: integration, error } = await supabase
      .from("user_integrations")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("app", app)
      .eq("provider", "google")
      .single();

    if (error || !integration) {
      console.error(`❌ Integration not found for ${app}:`, error);
      return null;
    }

    const { access_token, refresh_token, expires_at } = integration;

    // If token is not expired, return it
    if (access_token && !this.isTokenExpired(expires_at)) {
      return access_token;
    }

    // If no refresh token, cannot refresh
    if (!refresh_token) {
      console.error(`❌ No refresh token available for ${app}`);
      return null;
    }

    // Refresh the token
    console.log(`🔄 Refreshing expired token for ${app}...`);
    const result = await this.refreshTokenForApp(userId, app, refresh_token);

    if (result.success) {
      return result.accessToken!;
    }

    console.error(`❌ Failed to refresh token for ${app}: ${result.error}`);
    return null;
  }

  /**
   * Validate that all user tokens are fresh (used before MCP initialization)
   */
  async ensureAllTokensFresh(userId: string): Promise<{
    success: boolean;
    refreshedApps: string[];
    failedApps: string[];
  }> {
    console.log(`🔄 Ensuring all tokens are fresh for user: ${userId}`);

    const result = await this.refreshExpiredTokensForUser(userId);

    return {
      success: result.failedApps.length === 0,
      refreshedApps: result.refreshedApps,
      failedApps: result.failedApps,
    };
  }
}

// Export singleton instance
export const tokenRefreshManager = TokenRefreshManager.getInstance();
