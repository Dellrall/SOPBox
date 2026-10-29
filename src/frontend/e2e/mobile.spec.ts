import { createHmac } from "node:crypto";
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

async function openSettings(page: Page, tab: string) {
  await openPage(page, "Settings");
  await page.getByRole("tab", { name: tab }).tap();
  await expect(page.getByRole("tabpanel").getByRole("heading", { level: 2, name: tab, exact: true })).toBeVisible();
}

async function navLabels(page: Page) {
  await page.getByRole("button", { name: "Open the menu" }).click();
  const labels = await page.getByRole("navigation", { name: "Main" }).getByRole("button").allInnerTexts();
  await page.getByRole("button", { name: "Close the menu" }).click();
  return labels.map((l) => l.trim()).filter(Boolean);
}

test.describe("signed out", () => {
  test("a visitor leaves their details for sales", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("link", { name: "Contact sales" }).tap();
    await page.getByLabel("Your name").fill("Ana");
    await page.getByLabel("Email").fill(`ana${Date.now()}@example.com`);
    await page.getByLabel("Number of outlets").fill("12");
    await page.getByRole("button", { name: "Send to sales" }).tap();
    await expect(page.getByText(/Our sales team will reply to/)).toBeVisible();
    await expectFitsScreen(page);
  });

  test("Contact sales in the top bar opens the sales form, also from the contact page", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 }); // the top bar's links show from tablet width
    await page.goto("/contact");
    await expect(page.getByLabel("Your question")).toBeVisible();
    await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "Contact sales" }).click();
    await expect(page).toHaveURL(/\/contact\?topic=sales$/);
    await expect(page.getByLabel("Number of outlets")).toBeVisible();
  });

  test("the menu reaches every public page, and a visitor asks a question", async ({ page }) => {
    await page.goto("/");
    for (const [name, heading] of [["Pricing", "Free for one store"], ["Privacy", "Your data stays yours"], ["Contact", "How can we help?"]]) {
      await page.getByRole("button", { name: "Menu" }).tap();
      await page.getByRole("navigation", { name: "Site menu" }).getByRole("link", { name, exact: true }).tap();
      await expect(page.getByRole("heading", { level: 1, name: new RegExp(heading) })).toBeVisible();
    }
    await expect(page).toHaveTitle("Contact · SOPBox");
    await page.getByLabel("Your name").fill("Ben");
    await page.getByLabel("Email").fill(`ben${Date.now()}@example.com`);
    await page.getByLabel("Your question").fill("Does it work offline?");
    await page.getByRole("button", { name: "Send question" }).tap();
    await expect(page.getByText(/The SOPBox team will reply to/)).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toBeVisible();
  });

  for (const path of ["/", "/signin", "/register", "/pricing", "/privacy", "/contact"]) {
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

  test("on a small phone the helper starts small with its message folded away", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
    const show = page.getByRole("button", { name: "Show the helper's messages" });
    await expect(show).toBeVisible();
    await show.tap();
    await expect(show).toBeHidden();
    await page.reload(); // the person's choice is remembered
    await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
    await expect(show).toBeHidden();
  });

  test("every Settings tab fits a phone", async ({ page }, testInfo) => {
    await page.goto("/");
    await openPage(page, "Settings");
    for (const tab of await page.getByRole("tab").allInnerTexts()) {
      await test.step(tab, async () => {
        await page.getByRole("tab", { name: tab.trim() }).tap();
        await page.waitForLoadState("networkidle");
        await expectFitsScreen(page);
        await snapshot(page, testInfo, `owner – Settings – ${tab.trim()}`);
      });
    }
  });

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
    // The dashboard has no inbox list of its own, at most one line for the newest unread.
    await expect(page.locator("main h1:visible")).toHaveCount(1);
    await expect(page.locator("main").getByRole("heading", { name: /^Inbox/ })).toHaveCount(0);
    await page.locator("header").getByRole("button", { name: /inbox|notification/i }).first().tap();
    const inbox = page.getByRole("dialog", { name: "Inbox" });
    await expect(inbox).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const box = (await inbox.boundingBox())!;
    const screen = page.viewportSize()!;
    expect(box.height, "the inbox should fill the screen's height").toBeGreaterThanOrEqual(screen.height - 1);
    // Nothing on the page sits on top of it.
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="dialog"]') !== null, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(top).toBe(true);
    await page.getByRole("button", { name: "Close the inbox" }).tap();
    await expect(inbox).toBeHidden();
  });

  test("photos can be taken with the camera or chosen from the gallery", async ({ page }) => {
    await page.goto("/");
    await openPage(page, "Receiving check");
    const main = page.locator("main");
    await expect(main.getByText("Take photo", { exact: true })).toBeVisible();
    await expect(main.getByText("Choose photo", { exact: true })).toBeVisible();
    // Only "Take photo" asks for the camera; "Choose photo" opens the gallery.
    await expect(page.locator("#order-photo-camera")).toHaveAttribute("capture", "environment");
    await expect(page.locator("#order-photo-files")).not.toHaveAttribute("capture", /.*/);
    await expectFitsScreen(page);

    // A 1x1 PNG chosen as a stock photo shows up in the list.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await page.locator("#stock-photos-files").setInputFiles({ name: "stock.png", mimeType: "image/png", buffer: png });
    await expect(page.getByLabel("What photo 1 shows")).toBeVisible();
    await expect(main.getByText("Take another", { exact: true })).toBeVisible();
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

  test("a storage area added in Settings can be picked when moving stock", async ({ page }, testInfo) => {
    const outlet = `Outlet ${testInfo.project.name}`;
    await page.goto("/");
    await openSettings(page, "Workspace");
    await page.getByLabel("New outlet").fill(outlet);
    await page.getByRole("button", { name: "Add outlet" }).tap();
    await expect(page.getByText(outlet, { exact: true })).toBeVisible();
    await expectFitsScreen(page);

    await openPage(page, "Stock & sales");
    await page.getByRole("tab", { name: "Transfers" }).tap();
    await expect(page.getByLabel("To").locator("option", { hasText: `${outlet} / Store` })).toHaveCount(1);
    await page.getByRole("tab", { name: "Sales" }).tap();
    await expect(page.getByText("Choose sales sheet")).toBeVisible();
    await expectFitsScreen(page);
  });

  test("a manager makes an API key a till can use", async ({ page, playwright, baseURL }, testInfo) => {
    const name = `Till ${testInfo.project.name} ${Date.now()}`;
    await page.goto("/");
    await openSettings(page, "Integrations");
    await page.getByLabel("Key name").fill(name);
    await page.getByRole("button", { name: "Make a key" }).tap();
    const key = (await page.getByTestId("api-key").textContent()) ?? "";
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expectFitsScreen(page);

    const till = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${key}` } });
    expect((await till.get("/api/v1/stock")).ok()).toBe(true);
    await till.dispose();
  });

  test("an HQ owner switches into a linked branch", async ({ page, playwright, baseURL }, testInfo) => {
    const branch = await playwright.request.newContext({ baseURL });
    const username = `branch${testInfo.project.name.replace(/\W/g, "")}${Date.now()}`;
    const name = `Branch ${testInfo.project.name} ${Date.now()}`;
    expect((await branch.post("/api/auth/register", {
      data: { workspace_name: name, display_name: "Bea Branch", email: `${username}@example.com`, username, password: PASSWORD },
    })).ok()).toBe(true);
    const code = (await (await page.request.post("/api/workspace/link-codes")).json()).code;
    expect((await branch.post("/api/workspace/hq", { data: { code } })).ok()).toBe(true);
    await branch.dispose();

    await page.goto("/");
    await page.getByRole("button", { name: "Open the menu" }).click();
    const nav = page.getByRole("complementary").or(page.locator("aside"));
    await nav.getByLabel("Workspace").selectOption({ label: name });
    await expect(page).toHaveTitle(new RegExp(name));
    await expectFitsScreen(page);
  });

  test("the Settings switch opens every stock count category", async ({ page }) => {
    await page.goto("/");
    await openSettings(page, "Preferences");
    await page.getByLabel(/Open every category on Stock counts/).check();
    await openPage(page, "Stock Count");
    for (const name of [/^Chiller/, /^Frozen/, /^Room/, /^Packaging/])
      await expect(page.getByRole("button", { name })).toHaveAttribute("aria-expanded", "true");
  });
});

/** The authenticator app's code (RFC 6238), `steps` 30-second steps from now. */
function totp(secret: string, steps = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/\s/g, "")].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + steps));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test.describe("download your data", () => {
  test.use({ storageState: stateFile("owner") });
  test("the owner downloads a ZIP of the workspace's data from Settings", async ({ page }) => {
    await page.goto("/");
    await openSettings(page, "Data & privacy");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).tap();
    expect((await download).suggestedFilename()).toMatch(/^sopbox-export-.*\.zip$/);
    await expectFitsScreen(page);
  });
});

test.describe("closing the business", () => {
  test("the owner downloads a copy, closes it, sees it read-only, and reopens it", async ({ browser, baseURL }, testInfo) => {
    // Its own workspace: closing one the other tests share would stop them.
    const context = await browser.newContext({ baseURL, ...testInfo.project.use });
    const username = `close${testInfo.project.name.replace(/\W/g, "")}${Date.now()}`;
    const name = `Shut ${username}`;
    expect((await context.request.post("/api/auth/register", {
      data: { workspace_name: name, display_name: "Cleo Owner", email: `${username}@example.com`, username, password: PASSWORD },
    })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto("/");
    await openSettings(page, "Data & privacy");
    const close = page.getByRole("button", { name: "Close the business" });
    await page.getByLabel(`Type ${name} to confirm`).fill(name);
    await expect(close).toBeDisabled(); // a copy first, or say none is needed
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download your data" }).tap();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    await close.tap();
    await expect(page.getByRole("alert").filter({ hasText: "This business is closed." })).toBeVisible();
    expect((await context.request.post("/api/categories", { data: { name: "Dairy" } })).status()).toBe(403);
    await expectFitsScreen(page);
    await page.getByRole("button", { name: "Reopen the business" }).tap();
    await expect(page.getByRole("heading", { name: "Close the business" })).toBeVisible();
    expect((await context.request.post("/api/categories", { data: { name: "Dairy" } })).status()).toBe(201);
    await context.close();
  });
});

test.describe("two-step sign-in", () => {
  test("turning it on makes the next sign-in ask for a code", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, ...testInfo.project.use });
    const username = `mfa${testInfo.project.name.replace(/\W/g, "")}${Date.now()}`;
    expect((await context.request.post("/api/auth/register", {
      data: { workspace_name: `MFA ${username}`, display_name: "Mo Owner", email: `${username}@example.com`, username, password: PASSWORD },
    })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto("/");
    await openSettings(page, "Security");
    await page.getByRole("button", { name: "Set up two-step sign-in" }).tap();
    const secret = (await page.getByTestId("mfa-secret").textContent()) ?? "";
    await page.getByLabel("Code from your authenticator app").fill(totp(secret));
    await page.getByRole("button", { name: "Turn on" }).tap();
    await expect(page.getByTestId("backup-codes").locator("li")).toHaveCount(10);
    await page.getByRole("button", { name: "I've saved them" }).tap();
    await expectFitsScreen(page);

    await context.request.post("/api/auth/logout");
    expect((await (await context.request.post("/api/auth/login", { data: { username, password: PASSWORD } })).json()).mfa_pending).toBe(true);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible();
    await expectFitsScreen(page);
    await page.getByLabel("Code from your authenticator app").fill(totp(secret, 1));
    await page.getByRole("button", { name: "Finish signing in" }).tap();
    await openSettings(page, "Security");
    await expect(page.getByText("On", { exact: true })).toBeVisible();
    await context.close();
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
