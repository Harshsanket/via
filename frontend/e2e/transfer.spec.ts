import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

/**
 * Browser tests cannot drive the real save dialog, so this records what the
 * app writes into the chosen file. Each `showSaveFilePicker` call starts a new
 * buffer; `close` commits it and `abort` discards it.
 */
async function installDirectSaveMock(context: BrowserContext) {
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
      // The browser may not expose navigator.storage; the app allows it then.
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
}

async function readSavedFile(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(
    () =>
      (
        window as unknown as { __savedFiles: number[][] }
      ).__savedFiles.at(-1) ?? [],
  )
  return Buffer.from(bytes)
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
  // The short link carries the key in its fragment, never sent to the server.
  expect(receiveUrl).toMatch(/\/[a-z0-9]{4,6}#k=[A-Za-z0-9_-]{22}$/)
  return receiveUrl
}

/** Makes the sender's first peer connection report "failed" before the transfer. */
async function failFirstPeerConnection(page: Page) {
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection
    let created = 0

    // @ts-expect-error test shim around the browser constructor
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config)
        created += 1
        if (created !== 1) return

        const setLocalDescription = this.setLocalDescription.bind(this)
        Object.defineProperty(this, 'setLocalDescription', {
          configurable: true,
          value: async (description: RTCSessionDescriptionInit) => {
            await setLocalDescription(description)
            Object.defineProperty(this, 'connectionState', {
              configurable: true,
              get: () => 'failed',
            })
            this.dispatchEvent(new Event('connectionstatechange'))
          },
        })
      }
    }
  })
}

/**
 * Makes every sender peer connection report "connected" and then "failed"
 * before the transfer. Relay-only with no relay server means the real channel
 * can never open, so the retry budget cannot be reset by a real verification.
 */
async function failEveryPeerConnection(page: Page) {
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection

    // @ts-expect-error test shim around the browser constructor
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super({ ...config, iceTransportPolicy: 'relay', iceServers: [] })

        let state: RTCPeerConnectionState = 'new'
        Object.defineProperty(this, 'connectionState', {
          configurable: true,
          get: () => state,
        })

        const setLocalDescription = this.setLocalDescription.bind(this)
        Object.defineProperty(this, 'setLocalDescription', {
          configurable: true,
          value: async (description: RTCSessionDescriptionInit) => {
            await setLocalDescription(description)
            state = 'connected'
            this.dispatchEvent(new Event('connectionstatechange'))
            state = 'failed'
            this.dispatchEvent(new Event('connectionstatechange'))
          },
        })
      }
    }
  })
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

async function downloadFile(receiver: Page) {
  const download = receiver.getByRole('button', { name: 'Download' })
  await expect(download).toBeVisible({ timeout: 20_000 })
  await download.click()
}

test('receiver download starts the sender and saves the verified file', async ({
  page,
  context,
}) => {
  await installDirectSaveMock(context)

  const payload = Buffer.alloc(2 * 1024 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = index % 251
  }

  const receiveUrl = await createSendLink(page, 'via-e2e.bin', payload)
  const receiver = await openReceiver(context, receiveUrl, 'via-e2e.bin')

  await expect(receiver.getByText(/unauthorized/i)).toHaveCount(0)
  await downloadFile(receiver)

  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 45_000 })
  expect((await readSavedFile(receiver)).equals(payload)).toBe(true)

  await expect(
    page.getByText('Receiver verified and saved the file'),
  ).toBeVisible({ timeout: 20_000 })
})

test('retries the first connection instead of failing the session', async ({
  page,
  context,
}) => {
  await installDirectSaveMock(context)
  await failFirstPeerConnection(page)

  const payload = Buffer.alloc(512 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 13) % 251
  }

  const receiveUrl = await createSendLink(
    page,
    'first-connection.bin',
    payload,
  )
  const receiver = await openReceiver(
    context,
    receiveUrl,
    'first-connection.bin',
  )

  await downloadFile(receiver)

  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 45_000 })
  expect((await readSavedFile(receiver)).equals(payload)).toBe(true)
})

test('recovers when both first connections fail', async ({ page, context }) => {
  await installDirectSaveMock(context)
  await failFirstPeerConnection(page)

  const payload = Buffer.alloc(256 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 7) % 251
  }

  const receiveUrl = await createSendLink(page, 'both-first.bin', payload)

  const receiver = await context.newPage()
  await failFirstPeerConnection(receiver)
  await receiver.goto(receiveUrl)
  await expect(receiver.getByText('both-first.bin').first()).toBeVisible({
    timeout: 20_000,
  })

  await downloadFile(receiver)

  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 45_000 })
  expect((await readSavedFile(receiver)).equals(payload)).toBe(true)
})

test('gives up after the retry budget instead of looping', async ({
  page,
  context,
}) => {
  await installDirectSaveMock(context)
  await failEveryPeerConnection(page)

  const receiveUrl = await createSendLink(page, 'retry-loop.bin', Buffer.alloc(1024))
  const receiver = await context.newPage()
  await receiver.goto(receiveUrl)

  // Three failed attempts (the first plus MAX_RECOVERY_ATTEMPTS) must end in
  // the error card; a connect-then-fail flap must not reset the budget.
  await expect(page.getByText(/Could not connect directly/)).toBeVisible({
    timeout: 15_000,
  })
})

test('refuses to receive when the browser reports too little storage', async ({
  page,
  context,
}) => {
  // The quota only limits temporary storage; a file saved through the
  // picker goes to disk, so this test needs a browser without one.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    })
    try {
      Object.defineProperty(navigator.storage, 'estimate', {
        configurable: true,
        value: async () => ({ quota: 1024, usage: 1000 }),
      })
    } catch {
      // Ignore; the check below would fail without the mock.
    }
  })

  const payload = Buffer.alloc(64 * 1024)
  const receiveUrl = await createSendLink(page, 'no-room.bin', payload)
  const receiver = await openReceiver(context, receiveUrl, 'no-room.bin')

  await downloadFile(receiver)
  await expect(
    receiver.getByText('There is not enough free storage'),
  ).toBeVisible()
})

test('writes directly to the chosen file when the picker is available', async ({
  page,
  context,
}) => {
  await installDirectSaveMock(context)

  const payload = Buffer.alloc(64 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 11) % 251
  }

  const receiveUrl = await createSendLink(page, 'direct-save.bin', payload)
  const receiver = await openReceiver(context, receiveUrl, 'direct-save.bin')

  await downloadFile(receiver)
  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 45_000 })

  expect((await readSavedFile(receiver)).equals(payload)).toBe(true)
  await expect(
    page.getByText('Receiver verified and saved the file'),
  ).toBeVisible({ timeout: 20_000 })
})

test('recovers from a checksum mismatch', async ({ page, context }) => {
  await installDirectSaveMock(context)

  const payload = Buffer.alloc(1024 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 7) % 251
  }

  const receiveUrl = await createSendLink(page, 'corrupt-once.bin', payload)

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
  await downloadFile(receiver)

  const retryButton = receiver.getByRole('button', { name: 'Retry transfer' })
  await expect(retryButton).toBeVisible({ timeout: 45_000 })
  await retryButton.click()

  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 60_000 })
  expect((await readSavedFile(receiver)).equals(payload)).toBe(true)
})

test('resumes after the data channel is interrupted', async ({
  page,
  context,
}) => {
  await installDirectSaveMock(context)

  const payload = Buffer.alloc(5 * 1024 * 1024)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 13) % 251
  }

  const receiveUrl = await createSendLink(page, 'resume.bin', payload)

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
  await downloadFile(receiver)

  await expect(
    receiver.getByText('Saved directly to your chosen location'),
  ).toBeVisible({ timeout: 60_000 })
  expect((await readSavedFile(receiver)).equals(payload)).toBe(true)

  await expect(
    page.getByText('Receiver verified and saved the file'),
  ).toBeVisible({ timeout: 20_000 })
})

test('someone with the session id but not the key never gets the file', async ({
  page,
  context,
}) => {
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
  await expect(
    impostor.getByRole('alert').getByText("couldn't be decrypted"),
  ).toBeVisible({
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

test('pasting a short link keeps the URL short and joins', async ({
  page,
  context,
}) => {
  const receiveUrl = await createSendLink(
    page,
    'paste-short.bin',
    Buffer.from('paste the short link'),
  )
  const receiver = await context.newPage()
  await receiver.goto('/receive')
  await receiver
    .getByLabel('Via receive link or short code')
    .fill(receiveUrl)
  await receiver.getByRole('button', { name: 'Join session' }).click()

  const shortUrl = new URL(receiveUrl)
  await expect(receiver).toHaveURL(`${shortUrl.origin}${shortUrl.pathname}${shortUrl.hash}`)
  await expect(receiver.getByText('paste-short.bin').first()).toBeVisible({
    timeout: 20_000,
  })
})

test('receiver cancel returns to the key entry screen', async ({
  page,
  context,
}) => {
  const receiveUrl = await createSendLink(
    page,
    'cancel-me.bin',
    Buffer.from('cancel this transfer'),
  )
  const receiver = await openReceiver(context, receiveUrl, 'cancel-me.bin')

  const download = receiver.getByRole('button', { name: 'Download' })
  await expect(download).toBeVisible({ timeout: 20_000 })

  await receiver.getByRole('button', { name: 'Cancel' }).click()

  await expect(
    receiver.getByText('Paste the Via link', { exact: true }),
  ).toBeVisible()
  await expect(receiver.getByText('Something went wrong')).toHaveCount(0)
})

test('sender cancel returns to the file picker', async ({ page, context }) => {
  const receiveUrl = await createSendLink(
    page,
    'sender-cancel.bin',
    Buffer.from('cancel from the sender'),
  )
  const receiver = await openReceiver(context, receiveUrl, 'sender-cancel.bin')

  await expect(
    receiver.getByRole('button', { name: 'Download' }),
  ).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await expect(
    page.getByText('Please add a file to begin sharing'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Choose a file to send/ }),
  ).toBeVisible()
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
})

test('keeps the sender session when navigating away and back in-app', async ({
  page,
}) => {
  await createSendLink(page, 'retained.txt', Buffer.from('kept in memory'))

  await page.getByRole('link', { name: 'Via home' }).click()
  await expect(page.getByRole('heading', { name: 'Via.' })).toBeVisible()

  // Client-side navigation back, not a reload: the same socket still owns
  // the session, so the sender must land on the link page, not the dropzone.
  await page.getByRole('link', { name: 'Send' }).click()

  await expect(page.getByRole('button', { name: 'Copy Link' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.locator('#send-file-input')).toHaveCount(0)
})

test('falls back to temporary storage when the save picker is unavailable', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    })
  })

  const payload = Buffer.from('kept in temporary storage')
  const receiveUrl = await createSendLink(page, 'temporary.txt', payload)
  const receiver = await openReceiver(context, receiveUrl, 'temporary.txt')

  await downloadFile(receiver)

  const saveLink = receiver.getByRole('link', { name: 'Save file' })
  await expect(saveLink).toBeVisible({ timeout: 45_000 })
  await expect(saveLink).toHaveAttribute('download', 'temporary.txt')

  const downloadPromise = receiver.waitForEvent('download')
  await saveLink.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('temporary.txt')
})
