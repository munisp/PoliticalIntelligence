import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Compass,
  Scale,
  FlaskConical,
  FileText,
  HeartPulse,
  MessageSquareText,
  FolderOpen,
  ScrollText,
  Settings,
  CircleHelp,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Search,
  Bell,
  ClipboardCheck,
  WifiOff,
  UserRound,
  Menu,
  X,
  Download,
  MoreHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CommandPalette, {
  openCommandPalette,
} from "@/components/shared/CommandPalette";
import { useInstallPrompt, useOnlineStatus } from "@/hooks/use-pwa";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { LogOut } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Auth slot (Phase 5): sidebar user card + topbar control             */
/* ------------------------------------------------------------------ */

function userInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function roleLabel(role?: string | null, platformRole?: string | null): string {
  const r = role === "admin" ? "executive" : (platformRole ?? role ?? "user");
  return r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function AuthAvatar({ size = "h-7 w-7" }: { size?: string }) {
  const { user } = useAuth();
  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt=""
        aria-hidden
        className={cn(size, "shrink-0 rounded-full object-cover")}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        size,
        "flex shrink-0 items-center justify-center rounded-full bg-civic/20 font-mono text-[11px] font-medium text-civic",
      )}
    >
      {userInitials(user?.name)}
    </span>
  );
}

/** Sidebar user card: loading skeleton / sign-in link / user + logout. */
function AuthUserCard({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading account"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md border border-ink-subtle bg-ink-elevated px-2.5 py-2",
          collapsed && "justify-center px-0",
        )}
      >
        <span aria-hidden className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-ink-inset" />
        {!collapsed && (
          <span aria-hidden className="h-3 w-24 animate-pulse rounded bg-ink-inset" />
        )}
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <Link
        to={LOGIN_PATH}
        onClick={onNavigate}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md border border-ink-subtle bg-ink-elevated px-2.5 py-2 hover:border-civic/50",
          collapsed && "justify-center px-0",
        )}
      >
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-inset"
        >
          <UserRound className="h-4 w-4 text-ink-muted" />
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[13px] font-medium text-ink-primary">
              Sign in
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              Government SSO · role-based
            </span>
          </span>
        )}
      </Link>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border border-ink-subtle bg-ink-elevated px-2.5 py-2",
        collapsed && "justify-center px-0",
      )}
    >
      <AuthAvatar />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13px] font-medium text-ink-primary">
              {user.name ?? "Signed-in user"}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              {roleLabel(user.role, user.platformRole)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              logout();
              onNavigate?.();
            }}
            aria-label="Sign out"
            className="rounded p-1 text-ink-muted hover:text-ink-primary"
          >
            <LogOut aria-hidden className="h-4 w-4" />
          </button>
        </>
      )}
      {collapsed && (
        <span className="sr-only">
          Signed in as {user.name ?? "user"} — use the topbar to sign out
        </span>
      )}
    </div>
  );
}

/** Topbar auth control: loading skeleton / sign-in icon / avatar + sign out. */
function AuthTopbarControl() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <span
        aria-busy="true"
        aria-label="Loading account"
        className="h-8 w-8 animate-pulse rounded-full border border-ink-subtle bg-ink-elevated"
      />
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <Link
        to={LOGIN_PATH}
        aria-label="Sign in"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-subtle bg-ink-elevated text-ink-muted hover:border-civic/50 hover:text-ink-primary"
      >
        <UserRound aria-hidden className="h-4 w-4" />
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden max-w-32 truncate text-xs text-ink-secondary lg:inline">
        {user.name ?? "Signed-in user"}
      </span>
      <span
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-ink-subtle bg-ink-elevated"
        title={user.name ?? "Account"}
      >
        <AuthAvatar size="h-8 w-8" />
      </span>
      <button
        type="button"
        onClick={logout}
        aria-label="Sign out"
        title="Sign out"
        className="rounded p-1.5 text-ink-secondary hover:text-ink-primary"
      >
        <LogOut aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nav model                                                           */
/* ------------------------------------------------------------------ */

interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
  dot?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { label: "Executive Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { label: "Opportunity Explorer", href: "/opportunities", Icon: Compass },
  { label: "Policy & Legislation", href: "/legislation", Icon: Scale },
  { label: "Simulation Studio", href: "/simulation", Icon: FlaskConical },
  { label: "Executive Briefs", href: "/briefs", Icon: FileText },
  { label: "Data Source Health", href: "/data-health", Icon: HeartPulse },
  { label: "Copilot", href: "/copilot", Icon: MessageSquareText, dot: true },
];

const SECONDARY_NAV: NavItem[] = [
  /* INNOVATIONS-NAV */
  { label: "Innovations", href: "/innovations", Icon: Sparkles },
  { label: "Documents library", href: "/documents", Icon: FolderOpen },
  { label: "Audit log", href: "/audit-log", Icon: ScrollText },
  { label: "Settings", href: "/settings", Icon: Settings },
  { label: "Help & shortcuts", href: "/help", Icon: CircleHelp },
];

const PAGE_TITLES: Record<string, { title: string; crumb: string }> = {
  "/dashboard": { title: "Executive Dashboard", crumb: "Kaduna State / Overview" },
  "/opportunities": { title: "Opportunity Explorer", crumb: "Kaduna State / All sectors" },
  "/legislation": { title: "Policy & Legislation Workbench", crumb: "Kaduna State / Laws" },
  "/simulation": { title: "Simulation Studio", crumb: "Kaduna State / Scenarios" },
  "/briefs": { title: "Executive Briefs", crumb: "Kaduna State / Documents" },
  "/data-health": { title: "Data Source Health", crumb: "Platform / Pipelines" },
  "/copilot": { title: "Copilot", crumb: "Kaduna State / Assistant" },
};

const DEMO_ROLES = [
  "Governor · Executive",
  "Policy Analyst",
  "Legal Analyst",
  "Simulation Specialist",
  "Data Steward",
  "Platform Administrator",
] as const;

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const { canInstall, install } = useInstallPrompt();

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
      isActive
        ? "bg-ink-elevated text-ink-primary"
        : "text-ink-secondary hover:bg-ink-elevated/60 hover:text-ink-primary",
      collapsed && "justify-center px-0",
    );

  const activeBar = (isActive: boolean) => (
    <span
      aria-hidden
      className={cn(
        "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-civic transition-all duration-150",
        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40",
      )}
    />
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header block */}
      <div
        className={cn(
          "flex h-16 items-center gap-2.5 border-b border-ink-subtle px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <img src="/logo-mark.svg" alt="" className="h-8 w-8 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="caption-label text-[10px] text-ink-muted">MERIDIAN</p>
            <p className="truncate text-sm font-semibold text-ink-primary">
              Policy Twin
            </p>
          </div>
        )}
        {onToggleCollapse && !collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className="ml-auto rounded p-1 text-ink-muted hover:text-ink-primary"
          >
            <ChevronsLeft aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          className="mx-auto mt-2 rounded p-1 text-ink-muted hover:text-ink-primary"
        >
          <ChevronsRight aria-hidden className="h-4 w-4" />
        </button>
      )}

      {/* Jurisdiction selector */}
      <div className={cn("px-3 pt-3", collapsed && "px-2")}>
        <button
          type="button"
          aria-label="Select jurisdiction — current: Kaduna State, Nigeria"
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-ink-subtle bg-ink-elevated px-2.5 py-2 text-left hover:border-ink-strong",
            collapsed && "justify-center px-0",
          )}
        >
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-civic/15 font-mono text-[10px] font-medium text-civic"
          >
            KD
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink-primary">
                  Kaduna State
                </span>
                <span className="block text-[11px] text-ink-muted">Nigeria</span>
              </span>
              <ChevronDown aria-hidden className="h-4 w-4 text-ink-muted" />
            </>
          )}
        </button>
      </div>

      {/* Primary nav */}
      <nav aria-label="Primary" className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3">
        {PRIMARY_NAV.map(({ label, href, Icon, dot }) => (
          <NavLink
            key={href}
            to={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={navLinkClasses}
          >
            {({ isActive }) => (
              <>
                {activeBar(isActive)}
                <span className="relative shrink-0">
                  <Icon aria-hidden className="h-[18px] w-[18px]" />
                  {dot && (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-civic"
                    />
                  )}
                </span>
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Secondary nav */}
      <nav
        aria-label="Secondary"
        className="space-y-0.5 border-t border-ink-subtle px-3 py-2"
      >
        {canInstall && (
          <button
            type="button"
            onClick={() => void install()}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-civic hover:bg-ink-elevated/60",
              collapsed && "justify-center px-0",
            )}
          >
            <Download aria-hidden className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && "Install Meridian"}
          </button>
        )}
        {SECONDARY_NAV.map(({ label, href, Icon }) => (
          <NavLink
            key={href}
            to={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={navLinkClasses}
          >
            {({ isActive }) => (
              <>
                {activeBar(isActive)}
                <Icon aria-hidden className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User card — wired to useAuth() (Phase 5) */}
      <div className="border-t border-ink-subtle p-3">
        <AuthUserCard collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Topbar                                                              */
/* ------------------------------------------------------------------ */

function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const location = useLocation();
  const online = useOnlineStatus();
  const [jobsOpen, setJobsOpen] = useState(false);
  const [role, setRole] = useState<(typeof DEMO_ROLES)[number]>(DEMO_ROLES[0]);
  const page = PAGE_TITLES[location.pathname] ?? {
    title: "Meridian Policy Twin",
    crumb: "Kaduna State",
  };

  return (
    <header
      data-app-chrome
      className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-subtle bg-ink-base/85 px-4 backdrop-blur md:px-6"
    >
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="rounded p-1.5 text-ink-secondary hover:text-ink-primary xl:hidden"
      >
        <Menu aria-hidden className="h-5 w-5" />
      </button>

      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold text-ink-primary">
          {page.title}
        </h1>
        <p className="hidden truncate text-[11px] text-ink-muted sm:block">
          {page.crumb}
        </p>
      </div>

      {/* ⌘K command palette trigger */}
      <button
        type="button"
        onClick={openCommandPalette}
        className="mx-auto hidden w-full max-w-sm items-center gap-2 rounded-md border border-ink-subtle bg-ink-surface px-3 py-1.5 text-[13px] text-ink-muted hover:border-ink-strong md:flex"
      >
        <Search aria-hidden className="h-4 w-4" />
        <span className="flex-1 text-left">Search or ask Copilot…</span>
        <kbd className="rounded border border-ink-subtle bg-ink-inset px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Open search"
        className="rounded p-1.5 text-ink-secondary hover:text-ink-primary md:hidden"
      >
        <Search aria-hidden className="h-5 w-5" />
      </button>

      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        {!online && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-xs font-medium text-status-warning"
          >
            <WifiOff aria-hidden className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Offline — showing cached data</span>
          </span>
        )}

        {/* Data freshness chip */}
        <Link
          to="/data-health"
          className="hidden items-center gap-1.5 rounded-full border border-ink-subtle bg-ink-surface px-2.5 py-1 text-xs text-ink-secondary hover:border-ink-strong lg:inline-flex"
          aria-label="Data as of 12 Jan 2025 — open Data Source Health"
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-status-success" />
          Data as of 12 Jan 2025
        </Link>

        {/* Jobs indicator */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setJobsOpen((v) => !v)}
            aria-expanded={jobsOpen}
            aria-label="Background jobs"
            className="relative rounded p-1.5 text-ink-secondary hover:text-ink-primary"
          >
            <Bell aria-hidden className="h-5 w-5" />
            <span
              aria-hidden
              className="absolute right-1 top-1 h-2 w-2 animate-pulse-dot rounded-full bg-status-info motion-reduce:animate-none"
            />
          </button>
          {jobsOpen && (
            <div
              role="dialog"
              aria-label="Jobs"
              className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-ink-subtle bg-ink-elevated p-3 shadow-overlay"
            >
              <p className="caption-label text-ink-muted">Running jobs</p>
              <ul className="mt-2 space-y-2 text-[13px]">
                <li className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-secondary">
                    Simulation run — SME grants 2027
                  </span>
                  <span className="font-mono text-xs text-status-info">62%</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-secondary">
                    Brief generation — Q1 education
                  </span>
                  <span className="font-mono text-xs text-ink-muted">queued</span>
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Approval queue badge */}
        <Link
          to="/briefs"
          aria-label="Approval queue — 3 items awaiting your sign-off"
          className="relative rounded p-1.5 text-ink-secondary hover:text-ink-primary"
        >
          <ClipboardCheck aria-hidden className="h-5 w-5" />
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 font-mono text-[10px] font-medium text-ink-base"
          >
            3
          </span>
        </Link>

        {/* Role switcher (demo) */}
        <label className="hidden items-center gap-1.5 xl:flex">
          <span className="sr-only">Demo role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof DEMO_ROLES)[number])}
            className="rounded-md border border-ink-subtle bg-ink-surface px-2 py-1 text-xs text-ink-secondary"
          >
            {DEMO_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {/* Auth control — wired to useAuth() (Phase 5) */}
        <AuthTopbarControl />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile bottom navigation (<768px)                                   */
/* ------------------------------------------------------------------ */

const BOTTOM_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { label: "Explorer", href: "/opportunities", Icon: Compass },
  { label: "Workbench", href: "/legislation", Icon: Scale },
  { label: "Studio", href: "/simulation", Icon: FlaskConical },
];

function BottomNav({ onMore }: { onMore: () => void }) {
  return (
    <nav
      data-app-chrome
      aria-label="Mobile navigation"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-ink-subtle bg-ink-base/95 backdrop-blur md:hidden"
    >
      <div className="grid grid-cols-5">
        {BOTTOM_NAV.map(({ label, href, Icon }) => (
          <NavLink
            key={href}
            to={href}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                isActive ? "text-civic" : "text-ink-muted",
              )
            }
          >
            <Icon aria-hidden className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMore}
          className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-ink-muted"
        >
          <MoreHorizontal aria-hidden className="h-5 w-5" />
          More
        </button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * App shell: 264px sidebar (collapsible to 72px icon rail ≥1280px; overlay on
 * tablet; hidden on mobile) + 64px sticky topbar + <Outlet/> content slot +
 * mobile bottom navigation. The landing page at `/` does NOT use this layout.
 */
export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Close the overlay on route change.
  useEffect(() => setOverlayOpen(false), [location.pathname]);

  // '?' opens Help & shortcuts (design.md §7.1)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (!typing && e.key === "?") navigate("/help");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);

  const sidebar = useMemo(
    () => (
      <SidebarContent
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
    ),
    [collapsed],
  );

  return (
    <div className="min-h-[100dvh] bg-ink-base">
      <CommandPalette />

      {/* Desktop sidebar ≥1280px */}
      <aside
        data-app-chrome
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-ink-subtle bg-ink-surface transition-[width] duration-200 xl:block",
          collapsed ? "w-[72px]" : "w-[264px]",
        )}
      >
        {sidebar}
      </aside>

      {/* Tablet/mobile overlay sidebar */}
      {overlayOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-[rgba(4,8,18,0.6)]"
            onClick={() => setOverlayOpen(false)}
          />
          <aside
            data-app-chrome
            className="absolute inset-y-0 left-0 w-[264px] border-r border-ink-subtle bg-ink-surface shadow-overlay"
            aria-label="Navigation"
          >
            <button
              type="button"
              onClick={() => setOverlayOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-4 z-10 rounded p-1 text-ink-muted hover:text-ink-primary"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            <SidebarContent collapsed={false} onNavigate={() => setOverlayOpen(false)} />
          </aside>
        </div>
      )}

      <div
        className={cn(
          "flex min-h-[100dvh] flex-col transition-[padding] duration-200",
          collapsed ? "xl:pl-[72px]" : "xl:pl-[264px]",
        )}
      >
        <Topbar onOpenMobileNav={() => setOverlayOpen(true)} />
        <main className="flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-8 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomNav onMore={() => setOverlayOpen(true)} />
    </div>
  );
}
