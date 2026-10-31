import { expect, test } from '@playwright/test'

test.skip(
  !process.env.E2E_SOCKET_URL,
  'Set E2E_SOCKET_URL to run the admin config test against a real backend',
)

test('admin signs in, changes the default password and saves settings', async ({
  page,
}) => {
  await page.goto('/config')
  await expect(page.getByText('Admin sign-in')).toBeVisible()

  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByText('Admin account')).toBeVisible()
  await expect(page.getByText(/default admin password/i)).toBeVisible()

  await page.getByLabel('Current password').fill('admin')
  await page.getByLabel('Username').fill('owner')
  await page.getByLabel('New password', { exact: true }).fill('new-password-123')
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('new-password-123')
  await page.getByRole('button', { name: 'Change credentials' }).click()

  await expect(page.getByText('Admin credentials changed')).toBeVisible()

  await page.getByLabel('Code style').selectOption('alphanumeric')
  await page.getByLabel('Code length').selectOption('6')
  await page.getByRole('button', { name: 'Save settings' }).click()

  await expect(page.getByText('Settings saved')).toBeVisible()
})
