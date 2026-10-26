import { readFile } from 'node:fs/promises'

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
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
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

  const downloadPromise = receiver.waitForEvent('download', { timeout: 60_000 })
  await receiver.getByRole('button', { name: 'Download' }).click()
  const download = await downloadPromise
  const downloaded = await readFile((await download.path()) as string)
  expect(downloaded.equals(payload)).toBe(true)

  await expect(
    page.getByText('Complete — the receiver verified the file'),
  ).toBeVisible({ timeout: 20_000 })
})
