import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  Library,
  NotebookPen,
  Book,
  TrendingUp,
  Settings,
  Moon,
  Sun,
  User,
  Shield,
  Compass,
  Menu,
  Crown,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/i18n";
import LanguageSwitcher from "./LanguageSwitcher";

interface HeaderProps {
  className?: string;
}

export default function Header({ className }: HeaderProps) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();
  const { user, logout, isAuthenticated } = useAuth();
  const { t } = useTranslation();

  const { data: profile } = useQuery<{ avatarUrl?: string }>({
    queryKey: ["/api/me/profile"],
    enabled: isAuthenticated,
  });
  
  const isPro = user?.plan === "pro" || user?.plan === "admin" || user?.plan === "beta_pro";
  
  const navItems = [
    { icon: Compass, text: t('navigation.explore'), path: "/explore" },
    { icon: Library, text: t('navigation.library'), path: "/library" },
    { icon: NotebookPen, text: t('navigation.notebooks'), path: "/notebooks" },
    { icon: Book, text: t('navigation.glossary'), path: "/glossary" },
    ...(user?.role === 'admin' ? [{ icon: Zap, text: t('navigation.practice'), path: "/practice" }] : []),
    ...(user?.role === 'admin' ? [{ icon: Shield, text: t('navigation.admin'), path: "/admin" }] : []),
  ];

  const getInitials = (username?: string) => {
    if (!username) return "U";
    return username
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getUserRole = (role?: string) => {
    switch (role) {
      case 'admin':
        return 'Administrator';
      case 'user':
        return 'Language Learner';
      default:
        return 'User';
    }
  };

  return (
    <header
      className={cn(
        "bg-background border-b border-border sticky top-0 z-30",
        className,
      )}
    >
      <div className="px-4 sm:px-6 lg:px-8 mx-auto w-full max-w-[var(--page-max-width)] flex h-16 items-center justify-between">
        {/* Brand Name Only */}
        <div className="flex items-center">
          <Link href={isAuthenticated ? "/library" : "/explore"} className="flex items-center">
            <h1 className="text-xl font-bold text-[hsl(var(--brand))]">ReadAcross</h1>
          </Link>

          {/* Navigation Items (Desktop) */}
          <nav className="hidden md:flex items-center space-x-1 ml-8">
            {navItems.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={cn(
                  "flex items-center px-3 py-2 text-sm font-medium rounded-md",
                  location === item.path
                    ? "text-[hsl(var(--brand))] bg-[hsl(var(--brand-subtle))]"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <item.icon
                  className={cn(
                    "mr-2 h-4 w-4",
                    location === item.path ? "text-[hsl(var(--brand))]" : "text-muted-foreground",
                  )}
                />
                {item.text}
              </Link>
            ))}
          </nav>
        </div>

        {/* User menu and dark mode toggle */}
        <div className="flex items-center gap-2">
          {/* Pricing/Plan Button - Temporarily hidden during service maintenance */}
          
          {/* Language Switcher */}
          <LanguageSwitcher />
          
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className="rounded-full"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* User Account Dropdown */}
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative rounded-full h-8 w-8 p-0"
                >
                  <Avatar className="h-8 w-8">
                    {profile?.avatarUrl && (
                      <AvatarImage src={profile.avatarUrl} alt={user?.username || "User"} />
                    )}
                    <AvatarFallback className="bg-[hsl(var(--brand))] text-[hsl(var(--brand-foreground))] text-sm font-medium">
                      {getInitials(user?.username)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" sideOffset={12}>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user?.username || user?.email?.split('@')[0] || 'User'}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user?.email || getUserRole(user?.role)}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="flex w-full">
                    <span>{t('navigation.mypage')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  {t('auth.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  {t('auth.login')}
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">
                  {t('auth.signUp')}
                </Button>
              </Link>
            </div>
          )}

          {/* Mobile menu button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 md:hidden">
              {navItems.map((item) => (
                <DropdownMenuItem key={item.path} asChild>
                  <Link href={item.path} className="flex w-full">
                    <item.icon className="mr-2 h-4 w-4" />
                    {item.text}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
