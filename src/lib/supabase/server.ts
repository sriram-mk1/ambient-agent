import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Define a basic Database type to avoid the import error
type Database = any; // Replace with your actual database types

// Create a server-side Supabase client
export const createClient = async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => {
          return cookieStore.get(name)?.value;
        },
        set: (name: string, value: string, options: any) => {
          try {
            cookieStore.set({
              name,
              value,
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
              path: "/",
            });
          } catch (error) {
            // This can fail in middleware or when headers are already sent
            // That's normal and expected in some cases
            console.debug("Could not set cookie in server context:", name);
          }
        },
        remove: (name: string, options: any) => {
          try {
            cookieStore.set({
              name,
              value: "",
              ...options,
              maxAge: 0,
              expires: new Date(0),
              path: "/",
            });
          } catch (error) {
            // This can fail in middleware or when headers are already sent
            // That's normal and expected in some cases
            console.debug("Could not remove cookie in server context:", name);
          }
        },
      },
    },
  );
};

// Get the current session from the server
export async function getSession() {
  const supabase = await createClient();
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error) {
      console.error("Error getting session:", error);
      return null;
    }
    return session;
  } catch (error) {
    console.error("Error getting session:", error);
    return null;
  }
}

// Get the current user from the server
export async function getUser() {
  const supabase = await createClient();
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) {
      console.error("Error getting user:", error);
      return null;
    }
    return user;
  } catch (error) {
    console.error("Error getting user:", error);
    return null;
  }
}

// Helper function to sign out
export async function signOut() {
  const supabase = await createClient();
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
}

// Check if the user is authenticated (for protected routes)
export async function requireAuth(redirectTo = "/login") {
  const session = await getSession();
  if (!session) {
    return { redirect: { destination: redirectTo, permanent: false } };
  }
  return { props: { session } };
}
