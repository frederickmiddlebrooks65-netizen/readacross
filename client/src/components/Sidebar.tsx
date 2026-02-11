import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Upload, BookMarked, BookOpen, Settings, Menu, Shield } from "lucide-react";

interface SidebarProps {
  className?: string;
}

export default function Sidebar({ className }: SidebarProps) {
  const [location] = useLocation();

  const navItems = [
    { icon: Home, text: "Library", path: "/" },
    { icon: Upload, text: "Upload Document", path: "/upload" },
    { icon: BookMarked, text: "My Sentences", path: "/sentences" },
    { icon: BookOpen, text: "Notebooks", path: "/notebooks" },
    { icon: Shield, text: "Admin", path: "/admin" },
  ];

  return (
    <aside className={cn("w-64 bg-white border-r border-gray-200", className)}>
      <div className="px-6 py-4 border-b border-gray-200">
        <h1 className="text-xl font-bold text-primary">ReadAcross</h1>
        <p className="text-xs text-gray-500 mt-1">Language Learning Platform</p>
      </div>

      {/* Sidebar Navigation Items */}
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={cn(
              "flex items-center px-4 py-2 text-sm font-medium rounded-md",
              location === item.path
                ? "text-primary bg-highlight"
                : "text-gray-600 hover:bg-gray-50",
            )}
          >
            <item.icon
              className={cn(
                "mr-3 h-4 w-4",
                location === item.path ? "text-primary" : "text-gray-500",
              )}
            />
            {item.text}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <span className="text-white text-sm font-medium">JS</span>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-700">John Smith</p>
            <p className="text-xs text-gray-500">Starter Plan</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
