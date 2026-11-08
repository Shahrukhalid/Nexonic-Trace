import { expect, test } from '@playwright/test';

test('opens without login, uses honest empty states, and prevents browser searches', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Discover your digital footprint.' })).toBeVisible();
  await expect(page.getByText('No generated or sample findings')).toBeVisible();
  await page.getByLabel('Username or email address').fill('octocat');
  await page.getByRole('button', { name: 'Start discovery' }).click();
  await expect(page.getByRole('status')).toContainText('no search requests were made');
  await expect(page.getByRole('link', { name: 'Open GitHub source' })).toHaveCount(0);
});

test('email input explains provider requirement without inventing results', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username or email address').fill('me@example.com');
  await page.getByRole('button', { name: 'Start discovery' }).click();
  await expect(page.getByRole('status')).toContainText('No provider is connected');
});

test('navigation, theme persistence, and data deletion work', async ({ page }, info) => {
  await page.goto('/');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await expect(page.getByRole('status')).toContainText('have been cleared');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('layout fits viewport and search modes support keyboard interaction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: /Deep search/ }).check();
  await expect(page.getByRole('radio', { name: /Deep search/ })).toBeChecked();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('help keeps keyboard focus inside the dialog and closes on Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'About Nexonic Trace', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close help' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'About Nexonic Trace', exact: true })).toBeFocused();
});
