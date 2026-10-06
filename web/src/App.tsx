import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { api } from './api'
import Layout from './components/Layout'
import Login from './pages/Login'
import AppsPage from './pages/Apps'
import NewAppPage from './pages/NewApp'
import AppDetailPage from './pages/AppDetail'
import ImagesPage from './pages/Images'
import AgentsPage from './pages/Agents'
import SettingsPage from './pages/Settings'
import HelpPage from './pages/Help'
import Welcome from './pages/Welcome'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [firstRun, setFirstRun] = useState<boolean | null>(null)

  useEffect(() => {
    api.me().then(() => setAuthed(true), () => setAuthed(false))
    const onSignedOut = () => setAuthed(false)
    window.addEventListener('dockyard:signed-out', onSignedOut)
    return () => window.removeEventListener('dockyard:signed-out', onSignedOut)
  }, [])

  useEffect(() => {
    if (!authed) return
    // If the check fails, go straight to the dashboard rather than block on it.
    api.onboarding().then((o) => setFirstRun(o.pending), () => setFirstRun(false))
  }, [authed])

  if (authed === null) return null
  if (!authed) return <Login onSignedIn={() => setAuthed(true)} />
  if (firstRun === null) return null
  if (firstRun) return <Welcome onDone={() => setFirstRun(false)} />

  return (
    <Layout onSignOut={() => api.logout().finally(() => setAuthed(false))}>
      <Routes>
        <Route path="/" element={<AppsPage />} />
        <Route path="/apps/new" element={<NewAppPage />} />
        <Route path="/apps/:id/:tab?" element={<AppDetailPage />} />
        <Route path="/images" element={<ImagesPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
