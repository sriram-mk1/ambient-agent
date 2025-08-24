import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Use getSession() ONLY to check if logged in
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    redirect("/login?redirectedFrom=/dashboard");
  }

  // Use getUser() for all trusted user info
  const {
    data: { user: authUser },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !authUser) {
    redirect("/login?redirectedFrom=/dashboard");
  }

  return (
    <div className="min-h-screen w-full p-8">
      <div className="max-w-7xl mx-auto">{/* Empty dashboard content */}</div>
    </div>
  );
}
