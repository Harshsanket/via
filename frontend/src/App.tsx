import { lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import AuroraBackground from './components/AuroraBackground'
import ConnectionBanner from './components/ConnectionBanner'
import Footer from './components/Footer'
import Header from './components/Header'

import { socketConfigError } from './lib/env'
import { isValidShortCode } from './lib/validation'

const ConfigPage = lazy(() => import('./pages/config/ConfigPage'))
const Home = lazy(() => import('./pages/Home'))
const NotFound = lazy(() => import('./pages/NotFound'))
const ReceivePage = lazy(() => import('./pages/receive/Receive'))
const SendPage = lazy(() => import('./pages/send/Send'))

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[50dvh] w-full items-center justify-center gap-3 text-sm text-muted-foreground"
    >
      <Loader2
        className="h-5 w-5 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      Loading…
    </div>
  )
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col bg-transparent text-foreground">
      <AuroraBackground />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to content
      </a>
      <Header />
      {socketConfigError && (
        <div
          role="alert"
          className="mx-4 mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 sm:mx-6"
        >
          {socketConfigError}
        </div>
      )}
      <ConnectionBanner />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full flex-1 flex-col items-center px-4 pb-10 pt-6 focus:outline-none sm:px-6"
      >
        {children}
      </main>
      <Footer />
    </div>
  )
}

function ShortLinkRoute() {
  const { shortCode } = useParams<{ shortCode: string }>()
  if (!shortCode || !isValidShortCode(shortCode)) return <NotFound />
  return <ReceivePage />
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/send" element={<SendPage />} />
        <Route path="/receive/:sessionId" element={<ReceivePage />} />
        <Route path="/receive" element={<ReceivePage />} />
        <Route path="/:shortCode" element={<ShortLinkRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

function App() {
  return (
    <Routes>
      <Route
        path="/config"
        element={
          <Suspense fallback={<RouteFallback />}>
            <ConfigPage />
          </Suspense>
        }
      />
      <Route
        path="*"
        element={
          <Layout>
            <AppRoutes />
          </Layout>
        }
      />
    </Routes>
  )
}

export default App
