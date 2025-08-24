import { Sidebar } from "@/components/sidebar";

import { getUser } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userData = await getUser();
  const user = {
    name: userData?.user_metadata?.name || userData?.email || "User Name",
    email: userData?.email || "user@example.com",
  };

  return (
    <div className="flex h-screen">
      <Sidebar user={user} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
