"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PanelLeft, Sparkle, Search, Play, BookOpen, LayoutGrid, Settings, HelpCircle, SquarePen, Activity } from "lucide-react";

const navItems = [
  { 
    name: "Search", 
    href: "/dashboard/search", 
    icon: Search,
    isSearch: true
  },
  { name: "Chat", href: "/dashboard/chat", icon: SquarePen },
  { name: "Personalize", href: "/dashboard/personalize", icon: BookOpen },
  { name: "Connections", href: "/dashboard/connections", icon: LayoutGrid },
  { name: "Performance", href: "/dashboard/performance", icon: Activity },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

type User = {
  name: string;
  email: string;
  avatar?: string;
};

export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const handleCollapse = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
  };

  return (
    <div
      onClick={() => isCollapsed && handleCollapse(false)}
      className={cn(
        "relative flex h-screen flex-col border-r bg-[#F4F3ED] transition-all duration-300 ease-in-out shadow-[2px_0_8px_-1px_rgba(0,0,0,0.05)]",
        isCollapsed ? "w-16 cursor-e-resize" : "w-56",
      )}
    >
      <div className="flex h-16 items-center justify-between pl-3 pr-5">
        <div className="relative">
          <div className="flex items-center justify-center h-12 w-10">
            <Link
              href="/dashboard"
              className="relative flex items-center justify-center h-9 w-9"
            >
              <Sparkle
                size={22}
                strokeWidth={1.0}
                className="text-gray-900 fill-current"
              />
            </Link>
          </div>
        </div>
        {!isCollapsed && (
          <div className="flex items-center justify-center h-12 w-10">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handleCollapse(true);
              }}
              className="h-8 w-8 ml-1 rounded hover:bg-[#e9e7e2] hover:text-gray-800 transition-colors flex items-center justify-center"
            >
              <PanelLeft size={13} strokeWidth={1} className="text-gray-500" />
            </Button>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "group flex items-center h-9 text-[14px] text-gray-600 transition-colors rounded",
              "hover:bg-[#EAE8E4]",
              pathname === item.href &&
                !item.isSearch &&
                "bg-[#EAE8E4] text-gray-900",
              isCollapsed
                ? "justify-center w-10 mx-auto"
                : item.isSearch
                  ? "pl-3 pr-2"
                  : "pl-3.5 pr-2",
            )}
          >
            <div
              className={cn(
                "flex items-center w-full rounded",
                isCollapsed ? "justify-center" : "",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center",
                  isCollapsed ? "w-full" : "",
                )}
              >
                <item.icon
                  className={cn(
                    "h-3.5 w-3.5 transition-colors flex-shrink-0",
                    pathname === item.href
                      ? "text-gray-800"
                      : "text-gray-500 group-hover:text-gray-800",
                    item.isSearch && !isCollapsed && "ml-1",
                  )}
                />
              </div>
              {!isCollapsed && (
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1.5 ml-2">
                    <span
                      className={cn(
                        "text-sm leading-none font-medium transition-colors",
                        pathname === item.href
                          ? "text-gray-800"
                          : "text-gray-600 group-hover:text-gray-800",
                      )}
                    >
                      {item.name}
                    </span>
                    {item.isSearch && (
                      <kbd className="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded border border-gray-200">
                        ⌘K
                      </kbd>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Link>
        ))}
      </nav>
      <div className="mt-auto">
        <div
          className={cn("border-t mt-0", isCollapsed ? "p-2" : "px-3 py-2.5")}
        >
          <div
            className={cn(
              "flex items-center gap-2.5",
              isCollapsed && "flex-col",
            )}
          >
            <Avatar
              className={cn(
                "rounded transition-all duration-200 bg-purple-500 flex-shrink-0",
                isCollapsed ? "h-9 w-9" : "h-8 w-8",
              )}
            >
              <AvatarFallback className="rounded bg-purple-500 text-sm font-medium text-white">
                {user.name ? user.name[0].toUpperCase() : "U"}
              </AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight text-gray-800 truncate">
                  {user.name}
                </p>
                <p className="text-xs leading-tight text-gray-500 truncate">
                  {user.email}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
