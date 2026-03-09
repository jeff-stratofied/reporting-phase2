import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import ReportingPage from './pages/ReportingPage'
import RoiDetailPage from './pages/RoiDetailPage'
import { UserProvider, useUser } from './context/UserContext'
import EarningsDetailPage from './pages/EarningsDetailPage'
import AmortDetailPage from './pages/AmortDetailPage'
import { setGlobalFeeConfig } from './utils/loanEngine'
import platformConfig from './data/platformConfig.json'

import { loadUsers } from './utils/users.js'

/** Builds Routes so the "/" element is recreated whenever user changes (key forces remount). */
function AppRoutes() {
  const { userId, reportingKey } = useUser()
  return (
    <Routes>
      <Route path="/" element={<ReportingPage key={`${userId}-${reportingKey}`} />} />
      <Route path="/roi" element={<RoiDetailPage />} />
      <Route path="/earnings" element={<EarningsDetailPage />} />
      <Route path="/amort" element={<AmortDetailPage />} />
    </Routes>
  )
}

export default function App() {
  useEffect(() => {
    setGlobalFeeConfig({
      setupFee: Number(platformConfig.fees?.setupFee ?? 0),
      monthlyServicingBps: Number(platformConfig.fees?.monthlyServicingBps ?? 0),
    })
  
    loadUsers()
  }, [])

  return (
    <UserProvider>
      <BrowserRouter basename="/reporting-phase2">
        <AppShell>
          <AppRoutes />
        </AppShell>
      </BrowserRouter>
    </UserProvider>
  )
}