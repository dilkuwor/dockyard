import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from './ui'

export default function Layout({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  return (
    <div className="min-h-screen">
      <header className="border-b-2 border-ink bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link to="/" className="font-display text-[28px] leading-none font-bold tracking-tight">
            Dockyard
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/apps/new">
              <Button variant="primary" tabIndex={-1}>New app</Button>
            </Link>
            <Button variant="quiet" onClick={onSignOut}>Sign out</Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  )
}
