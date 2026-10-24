const { test, expect } = require('@playwright/test');

test('loads the page, runs app.js, and toggles the mobile navigation', async ({ page }) => {
  const pageErrors = [];
  let appScriptStatus;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/app.js') appScriptStatus = response.status();
  });

  const response = await page.goto('/');

  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle(/Гульнара Ханум/);
  expect(appScriptStatus).toBe(200);
  await expect(page.locator('html')).toHaveClass(/has-js/);

  const menuToggle = page.locator('.mobile-menu-toggle');
  const navigation = page.locator('#primary-nav');
  await expect(menuToggle).toBeVisible();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation).toBeHidden();

  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation).toBeHidden();
  await expect(menuToggle).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('builds a mixed quote and keeps email delivery behind the HTTP safety gate', async ({ page }) => {
  const leadRequests = [];
  const pageErrors = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/lead') leadRequests.push(request.method());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');

  await page.locator('#model-select').selectOption('ЛПШМ-2026-44-48');
  await page.locator('#model-qty').fill('9');
  await page.locator('#add-model').click();
  await expect(page.locator('#total-qty')).toHaveText('9 шт.');
  await expect(page.locator('#qty-feedback')).toContainText('Добавьте ещё 1 шт.');

  await page.locator('#model-select').selectOption('ШПШМ-2026-46-48');
  await page.locator('#model-qty').fill('1');
  await page.locator('#add-model').click();
  await expect(page.locator('#total-qty')).toHaveText('10 шт.');
  await expect(page.locator('#qty-feedback')).toContainText('Партия от 10 изделий сформирована');
  await expect(page.locator('#selected-items .cart-row')).toHaveCount(2);

  await page.locator('#contact').fill('Проверка браузера');
  await page.locator('#email').fill('e2e@example.test');
  await page.locator('#rfq-form input[name="consent"]').check();
  await page.locator('#rfq-form button[type="submit"]').click();

  await expect(page.locator('#form-hint')).toContainText('только по защищённому HTTPS-адресу');
  const fallback = page.locator('#quote-email-fallback');
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute('href', /^mailto:/);
  expect(leadRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
