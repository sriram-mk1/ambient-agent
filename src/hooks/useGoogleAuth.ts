import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export const useGoogleAuth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const connectGoogleAccount = async (app: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Start the OAuth flow by calling our API route with the app parameter
      const response = await fetch(`/api/auth/google?app=${app}`);
      const { url, error: apiError } = await response.json();

      if (!url || apiError) {
        throw new Error(apiError || "Failed to start Google OAuth flow");
      }

      // Redirect to Google OAuth consent screen with the specific app's scopes
      window.location.href = url;
    } catch (err) {
      console.error("Google connection error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to connect Google account",
      );
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    connectGoogleAccount,
    isLoading,
    error,
  };
};
