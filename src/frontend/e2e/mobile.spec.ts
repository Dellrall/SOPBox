import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PASSWORD, PEOPLE, STAFF_PIN, stateFile } from "./global-setup";

/**
 * Every screen at phone size: nothing pushes the page wider than the screen, the main heading and
 * controls are on screen, and the flows people use on a phone work by tapping. A screenshot of
 * each page is attached to the report.
 */

/** Fails with the widest offenders named, when anything makes the page scroll sideways. */
async function expectFitsScreen(page: Page) {
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const offenders: string[] = [];
    if (document.documentElement.scrollWidth > width + 1) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.right > width + 1) {
          const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 3).join(".")}`;
          offenders.push(`${label} (right edge ${Math.round(box.right)}px) "${(el.textContent ?? "").trim().slice(0, 40)}"`);
        }
      }
    }
    return { width, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 8) };
  });
  expect(result.scrollWidth, `page is wider than the ${result.width}px screen:\n${result.offenders.join("\n")}`).toBeLessThanOrEqual(result.width + 1);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function openPage(page: Page, label: string) {
  await page.getByRole("button", { name: "Open the menu" }).click();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeInViewport();
  await nav.getByRole("button", { name: label, exact: true }).click();
  await expect(nav).not.toBeInViewport();
  // Receiving check stays mounted (hidden) on other pages, so look for the visible heading.
  await expect(page.locator("main h1:visible")).toHaveCount(1);
  await page.waitForLoadState("networkidle");
}

async function navLabels(page: Page) {
  await page.getByRole("button", { name: "Open the menu" }).click();
  const labels = await page.getByRole("navigation", { name: "Main" }).getByRole("button").allInnerTexts();
  await page.getByRole("button", { name: "Close the menu" }).click();
  return labels.map((l) => l.trim()).filter(Boolean);
}

test.describe("signed out", () => {
  for (const path of ["/", "/signin", "/register"]) {
    test(`${path} fits a phone`, async ({ page }, testInfo) => {
      await page.goto(path);
      await expect(page.locator("h1, h2").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectFitsScreen(page);
      await snapshot(page, testInfo, path);
    });
  }

  test("signing in with a password works by tapping", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel("Username or email").fill(PEOPLE.staff.username);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
    // The sign-in before this one is shown, so a sign-in the person didn't make stands out.
    await expect(page.getByRole("status").filter({ hasText: "Your last sign-in was" })).toBeVisible();
    await expectFitsScreen(page);
  });

  test("the passkey button shows under the password form", async ({ page }) => {
    await page.goto("/signin");
    const passkey = page.getByRole("button", { name: "Sign in with a passkey" });
    await passkey.scrollIntoViewIfNeeded();
    await expect(passkey).toBeInViewport();
    expect((await passkey.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

for (const who of ["owner", "manager", "staff"] as const) {
  test.describe(`${who}: every page`, () => {
    test.use({ storageState: stateFile(who) });

    test("each page in the menu fits a phone", async ({ page }, testInfo) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
      const labels = await navLabels(page);
      expect(labels.length).toBeGreaterThan(2);
      for (const label of labels) {
        await test.step(label, async () => {
          await openPage(page, label);
          await expectFitsScreen(page);
          await snapshot(page, testInfo, `${who} – ${label}`);
        });
      }
    });
  });
}

test.describe("phone layout", () => {
  test.use({ storageState: stateFile("owner") });

  test("the header keeps the menu and inbox in reach, and menu items are big enough to tap", async ({ page }) => {
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open the menu" });
    await expect(menu).toBeInViewport();
    await expect(page.locator("header").getByRole("button", { name: /inbox|notification/i }).first()).toBeInViewport();
    await menu.tap();
    for (const item of await page.getByRole("navigation", { name: "Main" }).getByRole("button").all()) {
      const box = (await item.boundingBox())!;
      expect(box.height, `${await item.innerText()} is too small to tap`).toBeGreaterThanOrEqual(40);
    }
  });

  test("the inbox opens over the page, not inside the header", async ({ page }) => {
    await page.goto("/");
    await page.locator("header").getByRole("button", { name: /inbox|notification/i }).first().tap();
    const inbox = page.getByRole("dialog", { name: "Inbox" });
    await expect(inbox).toBeVisible();
    const box = (await inbox.boundingBox())!;
    const screen = page.viewportSize()!;
    expect(box.height, "the inbox should fill the screen's height").toBeGreaterThanOrEqual(screen.height - 1);
    // Nothing on the page sits on top of it.
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="dialog"]') !== null, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(top).toBe(true);
    await page.getByRole("button", { name: "Close the inbox" }).tap();
    await expect(inbox).toBeHidden();
  });

  test("stock count categories start minimised and open with a tap", async ({ page }) => {
    await page.goto("/");
    await openPage(page, "Stock Count");
    const frozen = page.getByRole("button", { name: /^Frozen/ });
    await expect(frozen).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("Frozen fries 2kg")).toBeHidden();
    await frozen.tap();
    await expect(frozen).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Frozen fries 2kg")).toBeVisible();
    await expectFitsScreen(page);
  });

  test("the Settings switch opens every stock count category", async ({ page }) => {
    await page.goto("/");
    await openPage(page, "Settings");
    await page.getByLabel(/Open every category on Stock counts/).check();
    await openPage(page, "Stock Count");
    for (const name of [/^Chiller/, /^Frozen/, /^Room/, /^Packaging/])
      await expect(page.getByRole("button", { name })).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("kitchen tablet", () => {
  test("staff tap their name and type a PIN", async ({ page }) => {
    // Its own manager sign-in: signing out below must not end the session other tests share.
    await page.request.post("/api/auth/login", { data: { username: PEOPLE.manager.username, password: PASSWORD } });
    expect((await page.request.post("/api/kitchen-devices", { data: { name: "Prep tablet" } })).status()).toBe(201);
    await page.request.post("/api/auth/logout");
    await page.goto("/signin");
    await expect(page.getByText("Who's signing in?")).toBeVisible();
    await expectFitsScreen(page);
    const person = page.getByRole("button", { name: PEOPLE.staff.name });
    expect((await person.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await person.tap();
    await page.getByLabel(`${PEOPLE.staff.name}'s PIN`).fill(STAFF_PIN);
    await page.getByRole("button", { name: "Sign in", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
  });
});
