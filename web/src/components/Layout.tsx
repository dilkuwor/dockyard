import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api } from '../api'
import { cx, useResource } from '../lib'
import { Button, Logo } from './ui'
import {
  IconApps,
  IconDashboard,
  IconImages,
  IconAgent,
  IconSettings,
  IconHelp,
  IconSearch,
  IconPlus,
  IconMenu,
  IconX,
  IconLogout,
  IconChevronRight,
  IconChevronLeft,
  IconTerminal,
} from './Icons'

const SIDEBAR_KEY = 'dockyard.sidebar'

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" title="Dockyard" className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight text-ink">
      <Logo className="size-7" />
      <span className={cx('flex min-w-0 flex-col', compact && 'md:hidden')}>
        <span className="text-[15px] font-bold leading-none tracking-tight">Dockyard</span>
        <span className="text-[11px] font-medium text-ink-soft">Control Plane</span>
      </span>
    </Link>
  )
}

export default function Layout({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Desktop only: the sidebar can shrink to an icon rail. The choice is remembered per browser.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded')
    } catch {
      // Private windows may refuse storage; the sidebar still works, it just forgets.
    }
  }, [collapsed])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { data: apps } = useResource(api.listApps, [], 8000)

  // Close mobile drawer on route changes
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setMobileOpen(false)
  }

  // Global keyboard shortcut for search (⌘K or /)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Detect if user is scoped inside a specific app
  const isAppScoped = pathname.startsWith('/apps/') && pathname !== '/apps/new'
  const activeAppId = isAppScoped ? pathname.split('/')[2] : null
  const currentApp = apps?.find((a) => a.id === activeAppId)
  const currentTab = isAppScoped ? pathname.split('/')[3] ?? '' : ''

  const runningCount = apps?.filter((a) => a.state === 'running' || a.lastDeployment?.status === 'running').length ?? 0
  const totalAppsCount = apps?.length ?? 0

  const navGroups = [
    {
      title: 'Workloads',
      items: [
        {
          to: '/',
          label: 'Overview & Apps',
          icon: IconDashboard,
          active: pathname === '/' || (!isAppScoped && pathname.startsWith('/apps')),
          badge: totalAppsCount > 0 ? `${runningCount}/${totalAppsCount}` : undefined,
        },
        {
          to: '/apps/new',
          label: 'New Application',
          icon: IconPlus,
          active: pathname === '/apps/new',
        },
      ],
    },
    {
      title: 'Infrastructure',
      items: [
        {
          to: '/images',
          label: 'Images & Storage',
          icon: IconImages,
          active: pathname.startsWith('/images'),
        },
      ],
    },
    {
      title: 'Automation & CI',
      items: [
        {
          to: '/agents',
          label: 'Agent Access & CI',
          icon: IconAgent,
          active: pathname.startsWith('/agents'),
        },
      ],
    },
    {
      title: 'Platform',
      items: [
        {
          to: '/settings',
          label: 'Registry Auth',
          icon: IconSettings,
          active: pathname.startsWith('/settings'),
        },
        {
          to: '/help',
          label: 'CLI & Docs',
          icon: IconHelp,
          active: pathname.startsWith('/help'),
        },
      ],
    },
  ]

  // Filter for search palette
  const filteredApps = (apps ?? []).filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()) ||
    a.slug.toLowerCase().includes(query.toLowerCase()) ||
    (a.image ?? '').toLowerCase().includes(query.toLowerCase())
  )

  const quickLinks = [
    { to: '/', label: 'Dashboard Overview', icon: IconDashboard },
    { to: '/apps/new', label: 'Create New Application', icon: IconPlus },
    { to: '/images', label: 'Unused Images & Prune', icon: IconImages },
    { to: '/agents', label: 'Agent Tokens & Webhooks', icon: IconAgent },
    { to: '/settings', label: 'Registry Credentials', icon: IconSettings },
    { to: '/help', label: 'CLI Installation & Guide', icon: IconTerminal },
  ].filter((l) => l.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-xs md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* The brand cell and the sidebar below it share one vertical line; the bar's bottom border
          only spans the content area, so the two lines meet in a T rather than crossing. */}
      <header className="sticky top-0 z-30 flex h-14 items-stretch bg-panel">
        <div
          className={cx(
            'hidden shrink-0 items-center border-r border-rule transition-[width] duration-200 md:flex',
            collapsed ? 'w-16 justify-center' : 'w-64 px-4',
          )}
        >
          <Brand compact={collapsed} />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4 border-b border-rule px-4 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="rounded p-1 text-ink-soft hover:bg-paper md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <IconMenu className="size-5" />
            </button>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
              <Link to="/" className="font-medium hover:text-ink">Dashboard</Link>
              {isAppScoped && currentApp && (
                <>
                  <IconChevronRight className="size-3 shrink-0 text-ink-soft/50" />
                  <span className="truncate font-semibold text-ink">{currentApp.name}</span>
                  {currentTab && (
                    <>
                      <IconChevronRight className="size-3 shrink-0 text-ink-soft/50" />
                      <span className="capitalize">{currentTab}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-md border border-rule bg-paper/70 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-slate-300 hover:text-ink sm:inline-flex"
            >
              <IconSearch className="size-3.5" />
              <span>Search apps & tools…</span>
              <kbd className="rounded border border-rule bg-panel px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">⌘K</kbd>
            </button>
            <Link to="/apps/new">
              <Button variant="primary" size="sm" className="gap-1.5">
                <IconPlus className="size-3.5" />
                <span>New App</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="flex">
      {/* Sidebar (Desktop persistent, Mobile slide-over) */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-rule bg-panel transition-[transform,width] duration-200 md:sticky md:top-14 md:z-20 md:h-[calc(100dvh-3.5rem)] md:translate-x-0',
          collapsed && 'md:w-16',
          mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Collapse toggle, straddling the sidebar's edge. Desktop only. */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="absolute top-4 -right-3 z-10 hidden size-6 items-center justify-center rounded-full border border-rule bg-panel text-ink-soft shadow-xs transition-colors hover:bg-paper hover:text-ink md:inline-flex"
        >
          {collapsed ? <IconChevronRight className="size-3.5" /> : <IconChevronLeft className="size-3.5" />}
        </button>

        {/* Brand Header, mobile drawer only. On desktop the logo lives in the top bar. */}
        <div className="flex h-14 items-center justify-between border-b border-rule px-4 md:hidden">
          <Brand />
          <button
            type="button"
            className="rounded p-1 text-ink-soft hover:bg-paper"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <IconX className="size-5" />
          </button>
        </div>

        {/* Sidebar Nav Items */}
        {/* In the rail, leave room at the top so the edge toggle does not sit on the first item. */}
        <div className={cx('flex-1 overflow-y-auto px-3 py-4 space-y-6', collapsed && 'md:px-2 md:pt-12')}>
          {/* Active App Context Box when deep inside an app */}
          {isAppScoped && activeAppId && (
            <Link
              to="/"
              title="All apps"
              className={cx(
                'flex items-center gap-2 rounded-lg border border-rule bg-paper px-2.5 py-2 text-ink-soft transition-colors hover:text-ink',
                collapsed && 'md:justify-center md:px-0',
              )}
            >
              <IconChevronLeft className="size-3.5 shrink-0" />
              <span className={cx('min-w-0', collapsed && 'md:hidden')}>
                <span className="block text-[10px] font-semibold tracking-wide uppercase">All apps</span>
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                  <span className={cx(
                    'size-1.5 shrink-0 rounded-full',
                    currentApp?.state === 'running' ? 'bg-starboard' : currentApp?.state === 'partial' ? 'bg-warn' : 'bg-ink-soft/40'
                  )} />
                  <span className="truncate">{currentApp?.name ?? activeAppId}</span>
                </span>
              </span>
            </Link>
          )}

          {/* Global Navigation Groups */}
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className={cx('px-2 text-[11px] font-semibold tracking-wider text-ink-soft/80 uppercase', collapsed && 'md:hidden')}>
                {group.title}
              </div>
              <nav className="space-y-0.5" aria-label={group.title}>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={item.label}
                      className={cx(
                        'flex items-center justify-between rounded-md px-2.5 py-1.75 text-sm font-medium transition-colors',
                        collapsed && 'md:justify-center md:px-0',
                        item.active
                          ? 'bg-ink/8 text-ink font-semibold'
                          : 'text-ink-soft hover:bg-ink/4 hover:text-ink',
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={cx('size-4 shrink-0', item.active ? 'text-ink' : 'text-ink-soft/80')} />
                        <span className={cx('truncate', collapsed && 'md:hidden')}>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span className={cx('rounded-full bg-ink/8 px-1.5 py-0.2 text-[11px] font-semibold tabular-nums text-ink-soft', collapsed && 'md:hidden')}>
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* Sidebar footer */}
        <div className={cx('border-t border-rule bg-paper/50 p-3', collapsed && 'md:p-2')}>
          <div className={cx('flex items-center justify-between gap-2', collapsed && 'md:justify-center')}>
            <div className={cx('min-w-0', collapsed && 'md:hidden')}>
              <p className="truncate text-xs font-semibold text-ink">Admin Session</p>
              <p className="truncate text-[11px] text-ink-soft">Single Docker Host</p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-rule bg-panel px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-paper hover:text-ink"
            >
              <IconLogout className="size-3.5" />
              <span className={cx(collapsed && 'md:hidden')}>Out</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-4 md:px-5 md:py-5">
        {children}
      </main>
      </div>

      {/* Global Command Palette (⌘K) Modal */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-ink/40 backdrop-blur-xs">
          <div
            className="fixed inset-0 -z-10"
            onClick={() => setPaletteOpen(false)}
          />
          <div className="w-full max-w-lg rounded-xl border border-rule bg-panel shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
              <IconSearch className="size-4 text-ink-soft" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search applications, navigate to pages…"
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-ink-soft/60"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="text-xs font-mono rounded px-1.5 py-0.5 bg-paper text-ink-soft"
              >
                ESC
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2 space-y-3">
              {/* Apps List */}
              {filteredApps.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[11px] font-semibold text-ink-soft uppercase tracking-wider">
                    Applications
                  </div>
                  <div className="space-y-0.5">
                    {filteredApps.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setPaletteOpen(false)
                          navigate(`/apps/${a.id}`)
                        }}
                        className="w-full flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-paper transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <IconApps className="size-4 text-ink-soft shrink-0" />
                          <div className="truncate">
                            <span className="font-medium text-ink">{a.name}</span>
                            <span className="ml-2 font-mono text-xs text-ink-soft">{a.url.replace('https://', '')}</span>
                          </div>
                        </div>
                        <span className={cx(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          a.state === 'running' ? 'bg-starboard/10 text-starboard' : 'bg-paper text-ink-soft'
                        )}>
                          {a.state ?? 'stopped'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Navigation Links */}
              {quickLinks.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[11px] font-semibold text-ink-soft uppercase tracking-wider">
                    Platform Navigation
                  </div>
                  <div className="space-y-0.5">
                    {quickLinks.map((link) => {
                      const Icon = link.icon
                      return (
                        <button
                          key={link.to}
                          type="button"
                          onClick={() => {
                            setPaletteOpen(false)
                            navigate(link.to)
                          }}
                          className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-paper transition-colors"
                        >
                          <Icon className="size-4 text-ink-soft shrink-0" />
                          <span className="font-medium text-ink">{link.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {filteredApps.length === 0 && quickLinks.length === 0 && (
                <div className="py-8 text-center text-sm text-ink-soft">
                  No matching apps or sections found.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
