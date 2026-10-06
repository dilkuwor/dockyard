import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { cx } from '../lib'
import { Button, Logo } from './ui'

export default function Layout({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const { pathname } = useLocation()
  const sections = [
    { to: '/', label: 'Apps', active: pathname === '/' || pathname.startsWith('/apps') },
    { to: '/images', label: 'Images', active: pathname.startsWith('/images') },
    { to: '/agents', label: 'Agents', active: pathname.startsWith('/agents') },
    { to: '/settings', label: 'Settings', active: pathname.startsWith('/settings') },
    { to: '/help', label: 'Help', active: pathname.startsWith('/help') },
  ]

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-rule bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-5">
          <Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
            <Logo />
            <span className="hidden sm:inline">Dockyard</span>
          </Link>
          <nav className="mr-auto ml-2 flex min-w-0 items-center gap-0.5 overflow-x-auto sm:ml-5" aria-label="Sections">
            {sections.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                aria-current={s.active ? 'page' : undefined}
                className={cx(
                  'rounded-md px-2.5 py-1.5 font-medium transition-colors',
                  s.active ? 'bg-ink/5 text-ink' : 'text-ink-soft hover:text-ink',
                )}
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <Link to="/apps/new" className="shrink-0">
            <Button variant="primary" tabIndex={-1}>New app</Button>
          </Link>
          <Button variant="quiet" className="shrink-0" onClick={onSignOut}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  )
}
