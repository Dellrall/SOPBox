import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { stateFile } from "./global-setup";

/**
 * Every page on a tablet, upright and on its side: nothing scrolls sideways, and a screenshot of
 * each page is attached to the report for a look at the layout.
 */

async function check(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForLoadState("networkidle");
  const { width, scrollWidth } = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(scrollWidth, `${name} is wider than the ${width}px screen`).toBeLessThanOrEqual(width + 1);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("the public pages fit a tablet", async ({ page }, testInfo) => {
  for (const path of ["/", "/pricing", "/docs", "/contact", "/privacy", "/signin", "/register"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await check(page, testInfo, path);
  }
});

test.describe("signed in", () => {
  test.use({ storageState: stateFile("owner") });

  test("every page and Settings tab fits a tablet", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open the menu" });
    const nav = page.getByRole("navigation", { name: "Main" });
    // Upright, the pages are in a drawer behind the menu button; on its side, the sidebar is always there.
    const drawer = await menu.isVisible();
    if (drawer) await menu.click();
    // Open every group, so all pages are listed.
    const closed = nav.locator("button[aria-expanded=false]");
    while ((await closed.count()) > 0) await closed.first().click();
    const labels = (await nav.locator("button:not([aria-expanded])").allTextContents()).map((l) => l.trim()).filter(Boolean);
    if (drawer) await page.getByRole("button", { name: "Close the menu" }).click();
    expect(labels.length).toBeGreaterThan(3);
    for (const label of labels) {
      if (drawer) await menu.click();
      await nav.getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator("main h1:visible")).toHaveCount(1);
      await check(page, testInfo, label);
    }
    for (const tab of await page.getByRole("tab").allInnerTexts()) {
      await page.getByRole("tab", { name: tab.trim() }).click();
      await check(page, testInfo, `Settings ${tab.trim()}`);
    }
  });
});
