import { defineConfig, devices } from '@playwright/test'

const FRONTEND_PORT = 4173
const MOCK_PORT = 3100
const externalSocketUrl = process.env.E2E_SOCKET_URL?.trim()
const socketUrl = externalSocketUrl || `http://127.0.0.1:${MOCK_PORT}`

type WebServer = {
  command: string
  url: string
  reuseExistingServer: boolean
  timeout: number
  env?: Record<string, string>
}

const webServer: WebServer[] = []

if (!externalSocketUrl) {
  webServer.push({
    command: 'node e2e/mock-signaling-server.mjs',
    url: `http://127.0.0.1:${MOCK_PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { MOCK_PORT: String(MOCK_PORT) },
  })
}

webServer.push({
  command: `VITE_SOCKET_SERVER_URL=${socketUrl} npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT}`,
  url: `http://127.0.0.1:${FRONTEND_PORT}`,
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
})

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 75_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
