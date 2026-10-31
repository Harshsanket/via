import { expect, test } from '@playwright/test'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })
test.skip(
  !process.env.E2E_SOCKET_URL,
  'Set E2E_SOCKET_URL to run the real-backend transfer test',
)

test('sends a file through the real signaling backend', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const target = window as unknown as {
      __savedFiles: number[][]
      showSaveFilePicker: unknown
    }
    target.__savedFiles = []

    try {
      Object.defineProperty(navigator.storage, 'estimate', {
        configurable: true,
        value: async () => ({ quota: 2 ** 40, usage: 0 }),
      })
    } catch {
      // Not available; the app allows the transfer then.
    }

    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => {
        let chunks: Uint8Array[] = []
        return {
          createWritable: async () => ({
            write: async (chunk: ArrayBuffer) => {
              chunks.push(new Uint8Array(chunk))
            },
            close: async () => {
              const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
              const merged = new Uint8Array(total)
              let offset = 0
              for (const chunk of chunks) {
                merged.set(chunk, offset)
                offset += chunk.length
              }
              target.__savedFiles.push(Array.from(merged))
            },
            abort: async () => {
              chunks = []
            },
          }),
        }
      },
    })
  })

  const payload = Buffer.alloc(512 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 17) % 251
  }

  await page.goto('/send')
  await page.locator('#send-file-input').setInputFiles({
    name: 'real-backend.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  })

  await expect(page.getByRole('button', { name: 'Copy Link' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Copy Link' }).click()
  await expect(page.getByRole('button', { name: 'Link Copied' })).toBeVisible()
  const receiveUrl = await page.evaluate(() => navigator.clipboard.readText())

  const receiver = await context.newPage()
  await receiver.goto(receiveUrl)
  await expect(receiver.getByText('real-backend.bin').first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(receiver.getByText(/unauthorized/i)).toHaveCount(0)

  // The join extends the session (REFRESH_SESSION_TTL_SECONDS, 30 minutes by
  // default); the sender's countdown must follow instead of the initial 10.
  await expect(
    page
      .getByText('Session expires in')
      .locator('xpath=following-sibling::span[1]'),
  ).toHaveText(/^(29|30)m/, { timeout: 10_000 })

  const download = receiver.getByRole('button', { name: 'Download' })
  await expect(download).toBeVisible({ timeout: 20_000 })
  await download.click()
  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 60_000 })

  const saved = await receiver.evaluate(
    () =>
      (
        window as unknown as { __savedFiles: number[][] }
      ).__savedFiles.at(-1) ?? [],
  )
  expect(Buffer.from(saved).equals(payload)).toBe(true)

  await expect(
    page.getByText('Receiver verified and saved the file'),
  ).toBeVisible({ timeout: 20_000 })
})
