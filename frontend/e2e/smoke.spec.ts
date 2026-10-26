import { expect, test } from '@playwright/test'

test('renders the home page without a header', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Via.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Send' })).toBeVisible()
  await expect(page.getByRole('banner')).toHaveCount(0)

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
})

test('shows the via. header away from the home page', async ({ page }) => {
  await page.goto('/send')
  const header = page.getByRole('banner')
  await expect(header).toBeVisible()
  await expect(header.getByRole('link')).toHaveText('via.')
})

test('validates a receive session key', async ({ page }) => {
  await page.goto('/receive')
  await page.getByLabel('Session key or receive link').fill('bad')
  await page.getByRole('button', { name: 'Join session' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Paste the receive link the sender shared.')
  await expect(alert).toBeFocused()
})

test('refuses a link without its security key', async ({ page }) => {
  await page.goto('/receive')
  await page
    .getByLabel('Session key or receive link')
    .fill('http://127.0.0.1:4173/receive/abcd1234-not-keyed')
  await page.getByRole('button', { name: 'Join session' }).click()
  await expect(page.getByRole('alert')).toContainText('missing its security key')
})

test('shows a retry banner when the signaling server is unreachable', async ({
  page,
}) => {
  await page.route('**/socket.io/**', (route) => route.abort())
  await page.goto('/receive')

  await expect(page.getByText(/Signaling server unreachable/)).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: 'Retry now' })).toBeVisible()
})
