import { readFile } from 'node:fs/promises'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

async function forceFallbackDownload(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    })
  })
}

async function createSendLink(page: Page, name: string, buffer: Buffer) {
  await page.goto('/send')
  await page.locator('#send-file-input').setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer,
  })

  await expect(page.getByRole('button', { name: 'Copy Link' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Copy Link' }).click()
  await expect(page.getByRole('button', { name: 'Link Copied' })).toBeVisible()

  const receiveUrl = await page.evaluate(() => navigator.clipboard.readText())
  // The link carries the key in its fragment, never sent to the server.
  expect(receiveUrl).toMatch(/\/receive\/[A-Za-z0-9_-]+#k=[A-Za-z0-9_-]{22}$/)
  return receiveUrl
}

async function openReceiver(
  context: BrowserContext,
  receiveUrl: string,
  fileName: string,
) {
  const receiver = await context.newPage()
  await receiver.goto(receiveUrl)
  await expect(receiver.getByText(fileName).first()).toBeVisible({
    timeout: 20_000,
  })
  return receiver
}

test('receiver download starts the sender and saves the verified file', async ({
  page,
  context,
}) => {
  await forceFallbackDownload(context)

  const payload = Buffer.alloc(2 * 1024 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = index % 251
  }

  const receiveUrl = await createSendLink(page, 'via-e2e.bin', payload)
  const receiver = await openReceiver(context, receiveUrl, 'via-e2e.bin')

  await expect(receiver.getByText(/unauthorized/i)).toHaveCount(0)
  await expect(receiver.getByRole('button', { name: 'Download' })).toBeVisible()

  const downloadPromise = receiver.waitForEvent('download')
  await receiver.getByRole('button', { name: 'Download' }).click()

  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()

  const downloaded = await readFile(downloadPath as string)
  expect(downloaded.equals(payload)).toBe(true)

  await expect(
    page.getByText('Complete — the receiver verified the file'),
  ).toBeVisible({ timeout: 20_000 })
})

test('writes directly to the chosen file when the picker is available', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const target = window as unknown as {
      __directChunks: Uint8Array[]
      showSaveFilePicker: unknown
    }
    target.__directChunks = []

    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        createWritable: async () => ({
          write: async (chunk: ArrayBuffer) => {
            target.__directChunks.push(new Uint8Array(chunk))
          },
          close: async () => undefined,
          abort: async () => undefined,
        }),
      }),
    })
  })

  const payload = Buffer.alloc(64 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 11) % 251
  }

  const receiveUrl = await createSendLink(page, 'direct-save.bin', payload)
  const receiver = await openReceiver(context, receiveUrl, 'direct-save.bin')

  await receiver.getByRole('button', { name: 'Download' }).click()
  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 45_000 })

  const saved = await receiver.evaluate(() => {
    const chunks = (
      window as unknown as { __directChunks: Uint8Array[] }
    ).__directChunks
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return Array.from(merged)
  })

  expect(Buffer.from(saved).equals(payload)).toBe(true)
  await expect(
    page.getByText('Complete — the receiver verified the file'),
  ).toBeVisible({ timeout: 20_000 })
})

test('recovers from a checksum mismatch', async ({ page, context }) => {
  await forceFallbackDownload(context)

  const payload = Buffer.alloc(1024 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 7) % 251
  }

  await page.goto('/send')
  await page.locator('#send-file-input').setInputFiles({
    name: 'corrupt-once.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  })

  await expect(page.getByRole('button', { name: 'Copy Link' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Copy Link' }).click()
  await expect(page.getByRole('button', { name: 'Link Copied' })).toBeVisible()
  const receiveUrl = await page.evaluate(() => navigator.clipboard.readText())

  await page.evaluate(() => {
    const originalSend = RTCDataChannel.prototype.send
    let corrupted = false
    RTCDataChannel.prototype.send = function (data) {
      if (!corrupted && data instanceof ArrayBuffer && data.byteLength > 0) {
        corrupted = true
        new Uint8Array(data)[0] ^= 0xff
      }
      return originalSend.call(this, data)
    }
  })

  const receiver = await openReceiver(context, receiveUrl, 'corrupt-once.bin')
  const downloadPromise = receiver.waitForEvent('download', { timeout: 60_000 })
  await receiver.getByRole('button', { name: 'Download' }).click()

  const retryButton = receiver.getByRole('button', { name: 'Retry transfer' })
  await expect(retryButton).toBeVisible({ timeout: 45_000 })
  await retryButton.click()

  const download = await downloadPromise
  const downloaded = await readFile((await download.path()) as string)
  expect(downloaded.equals(payload)).toBe(true)
})

test('resumes after the data channel is interrupted', async ({
  page,
  context,
}) => {
  await forceFallbackDownload(context)

  const payload = Buffer.alloc(5 * 1024 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 13) % 251
  }

  await page.goto('/send')
  await page.locator('#send-file-input').setInputFiles({
    name: 'resume.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  })

  await expect(page.getByRole('button', { name: 'Copy Link' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Copy Link' }).click()
  await expect(page.getByRole('button', { name: 'Link Copied' })).toBeVisible()
  const receiveUrl = await page.evaluate(() => navigator.clipboard.readText())

  await page.evaluate(() => {
    const originalSend = RTCDataChannel.prototype.send
    let sent = 0
    RTCDataChannel.prototype.send = function (data) {
      const result = originalSend.call(this, data)
      if (data instanceof ArrayBuffer) {
        sent += 1
        if (sent === 10) {
          queueMicrotask(() => this.close())
        }
      }
      return result
    }
  })

  const receiver = await openReceiver(context, receiveUrl, 'resume.bin')
  const downloadPromise = receiver.waitForEvent('download', { timeout: 60_000 })
  await receiver.getByRole('button', { name: 'Download' }).click()

  const download = await downloadPromise
  const downloaded = await readFile((await download.path()) as string)
  expect(downloaded.equals(payload)).toBe(true)

  await expect(
    page.getByText('Complete — the receiver verified the file'),
  ).toBeVisible({ timeout: 20_000 })
})

test('someone with the session id but not the key never gets the file', async ({
  page,
  context,
}) => {
  await forceFallbackDownload(context)

  const payload = Buffer.from('only for the person holding the link')
  const receiveUrl = await createSendLink(page, 'private.txt', payload)

  // What the signaling server itself could attempt: it knows the session id
  // but never sees the #fragment, so any key it uses is a guess.
  const forged = receiveUrl.replace(/#k=.*$/, `#k=${'A'.repeat(22)}`)
  expect(forged).not.toBe(receiveUrl)

  const senderEvents: string[] = []
  page.on('console', (message) => senderEvents.push(message.text()))

  const impostor = await context.newPage()
  const downloads: unknown[] = []
  impostor.on('download', (download) => downloads.push(download))
  await impostor.goto(forged)

  // The encrypted file details stay unreadable to the impostor...
  await expect(impostor.getByText("couldn't be decrypted")).toBeVisible({
    timeout: 20_000,
  })
  await expect(impostor.getByText('private.txt')).toHaveCount(0)

  // ...the connection is abandoned (whichever side's check reports first;
  // here the honest-but-wrong receiver also notices and says so)...
  await expect(
    page
      .getByText(/Security check failed|The receiver could not complete the transfer/)
      .first(),
  ).toBeVisible({ timeout: 30_000 })

  // ...and no file bytes were ever sent.
  expect(senderEvents.some((text) => text.includes('peer.verified'))).toBe(false)
  expect(senderEvents.some((text) => text.includes('transfer.started'))).toBe(false)
  expect(downloads).toHaveLength(0)
})
