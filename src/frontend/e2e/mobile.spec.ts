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
  await page.getByRole("button", { name: "More", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeInViewport();
  await openGroups(page);
  await nav.getByRole("button", { name: label, exact: true }).click();
  await expect(nav).not.toBeInViewport();
  // Receiving check stays mounted (hidden) on other pages, so look for the visible heading.
  await expect(page.locator("main h1:visible")).toHaveCount(1);
  await page.waitForLoadState("networkidle");
}

async function openSettings(page: Page, tab: string) {
  await openPage(page, "Settings");
  await page.getByRole("tab", { name: tab }).tap();
  await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
}

/** Opens every closed group in the menu, so all pages can be clicked. */
async function openGroups(page: Page) {
  const closed = page.getByRole("navigation", { name: "Main" }).locator("button[aria-expanded=false]");
  while ((await closed.count()) > 0) await closed.first().click();
}

/** The pages in the menu (not the group buttons that open and close). */
async function navLabels(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await openGroups(page);
  const labels = await page.getByRole("navigation", { name: "Main" }).locator("button:not([aria-expanded])").allInnerTexts();
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

  test("the header and footer lead to the docs", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 }); // the header's main links show from laptop width
    await page.goto("/pricing");
    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Docs" }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(page).toHaveTitle("Docs · SOPBox");
    await expect(page.getByRole("heading", { name: "Outlets and plans" })).toBeVisible();
    await page.getByRole("navigation", { name: "Product" }).getByRole("link", { name: "Docs" }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("the menu reaches every public page, and a visitor asks a question", async ({ page }) => {
    await page.goto("/");
    for (const [name, heading] of [["Pricing", "Free for one store"], ["Docs", "How to use SOPBox"], ["Privacy", "Your data stays yours"], ["Contact", "How can we help?"]]) {
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

  for (const path of ["/", "/signin", "/register", "/pricing", "/docs", "/privacy", "/contact"]) {
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
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).tap();
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
    // The sign-in before this one is shown, so a sign-in the person didn't make stands out.
    await expect(page.getByRole("status").filter({ hasText: /last sign-in:/i })).toBeVisible();
    await expectFitsScreen(page);
  });

  test("creating a workspace suggests a username from the email until one is typed", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill("Aina.R@kopi.my");
    await expect(page.getByLabel("Username")).toHaveValue("aina.r");
    await page.getByLabel("Username").fill("kopiaina");
    await page.getByLabel("Email").fill("other@kopi.my");
    await expect(page.getByLabel("Username")).toHaveValue("kopiaina");
    await page.getByRole("button", { name: "Show password" }).tap();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await expectFitsScreen(page);
  });

  test("the passkey button shows under the password form", async ({ page }) => {
    await page.goto("/signin");
    const passkey = page.getByRole("button", { name: "Sign in with a passkey" });
    await passkey.scrollIntoViewIfNeeded();
    await expect(passkey).toBeInViewport();
    expect((await passkey.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("the sign-in options wait for each other, so passkey never shows alone while Google loads", async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/auth/methods", async (route) => {
      await held;
      await route.fulfill({ json: { google: true, telegram_bot_id: null } });
    });
    await page.goto("/signin");
    await expect(page.getByLabel("Loading sign-in options")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeHidden();
    release();
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
    // Kept on the device, so the next visit shows every option at once.
    await page.unroute("**/api/auth/methods");
    await page.route("**/api/auth/methods", () => new Promise(() => {}));
    await page.reload();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  });
});

for (const who of ["owner", "manager", "staff"] as const) {
  test.describe(`${who}: every page`, () => {
    test.use({ storageState: stateFile(who) });

    test("each page in the menu fits a phone", async ({ page }, testInfo) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
    const show = page.getByRole("button", { name: "Show the helper's messages" });
    await expect(show).toBeVisible();
    await show.tap();
    await expect(show).toBeHidden();
    await page.reload(); // the person's choice is remembered
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
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
    const menu = page.getByRole("button", { name: "More", exact: true });
    await expect(menu).toBeInViewport();
    await expect(page.locator("header").getByRole("button", { name: /inbox|notification/i }).first()).toBeInViewport();
    await menu.tap();
    for (const item of await page.getByRole("navigation", { name: "Main" }).getByRole("button").all()) {
      const box = (await item.boundingBox())!;
      expect(box.height, `${await item.innerText()} is too small to tap`).toBeGreaterThanOrEqual(40);
    }
  });

  test("the bottom bar opens common pages in one tap, and More opens the full menu", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("navigation", { name: "Quick" });
    await expect(bar).toBeInViewport();
    await expect(bar.getByRole("button")).toHaveText([/Dashboard/, /Approvals/, /Receive/, /Stock/, /More/]);
    await bar.getByRole("button", { name: "Stock" }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Stock Count" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Stock" })).toHaveAttribute("aria-current", "page");
    await bar.getByRole("button", { name: "More" }).tap();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeInViewport();
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

  test("a product's barcode finds it when receiving, and the scan button is there", async ({ page }) => {
    await page.goto("/");
    const barcode = "9556000000017"; // the same in every project: they share one database
    const fries = (await (await page.request.get("/api/products")).json()).find((p: { name: string }) => p.name === "Frozen fries 2kg");
    const { name, category_id, base_unit, temp_min_c, temp_max_c, min_stock, sop, pack_units, code } = fries;
    const saved = await page.request.put(`/api/products/${fries.id}`, {
      data: { name, category_id, base_unit, temp_min_c, temp_max_c, min_stock, sop, pack_units, code, barcode },
    });
    expect(saved.ok()).toBe(true);

    await openPage(page, "Receiving check");
    await page.getByRole("button", { name: "Add a line" }).tap();
    const picker = page.locator("main").getByLabel("Product", { exact: true }).last();
    await expect(page.locator("main").getByRole("button", { name: "Scan barcode" }).first()).toBeVisible();
    await expectFitsScreen(page);
    await picker.tap();
    await page.getByRole("combobox", { name: "Search products" }).fill(barcode);
    await page.getByRole("option", { name: "Frozen fries 2kg" }).tap();
    await expect(picker).toHaveText("Frozen fries 2kg");
  });

  test("a manager adds a ready-made task list and ticks a step", async ({ page }, testInfo) => {
    await page.goto("/");
    await openPage(page, "Tasks");
    const main = page.locator("main");
    const starter = main.getByRole("button", { name: "Peak hour", exact: true });
    // The projects share one database: the first one adds the list, the rest find it.
    if (await starter.isVisible()) await starter.tap();
    const list = main.getByRole("button", { name: /^Peak hour.*(done|All done)/ });
    await expect(list).toBeVisible();
    if ((await list.getAttribute("aria-expanded")) === "false") await list.tap();
    // Each project ticks its own step, so they don't undo each other.
    const text = testInfo.project.name === "iphone-se" ? "Put a runner on the counter" : "Restock sauces and packaging";
    const step = main.getByRole("checkbox", { name: text });
    await main.getByText(text, { exact: true }).tap();
    await expect(step).toBeChecked();
    await expectFitsScreen(page);
    await main.getByText(text, { exact: true }).tap();
    await expect(step).not.toBeChecked();
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
    await page.getByRole("combobox", { name: "To" }).tap();
    await page.getByRole("option", { name: `${outlet} / Store` }).tap();
    await expect(page.getByRole("combobox", { name: "To" })).toHaveText(`${outlet} / Store`);
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
    await page.getByRole("button", { name: "More", exact: true }).click();
    const nav = page.getByRole("complementary").or(page.locator("aside"));
    await nav.getByRole("button", { name: /Switch workspace/ }).click();
    await nav.getByRole("list", { name: "Workspaces" }).getByRole("button", { name }).click();
    await expect(page).toHaveTitle(new RegExp(name));
    const branchUrl = page.url();
    // The address names the branch: back returns to HQ, forward to the branch, and a refresh stays there.
    await page.goBack();
    await expect(page).not.toHaveTitle(new RegExp(name));
    await page.goForward();
    await expect(page).toHaveTitle(new RegExp(name));
    await page.reload();
    await expect(page).toHaveTitle(new RegExp(name));
    expect(page.url()).toBe(branchUrl);
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

test.describe("outlets", () => {
  test("a manager starts at their outlet and adds staff and assistant managers there", async ({ browser, baseURL }, testInfo) => {
    const owner = await browser.newContext({ baseURL, ...testInfo.project.use });
    const tag = `${testInfo.project.name.replace(/\W/g, "")}${Date.now()}`;
    expect((await owner.request.post("/api/auth/register", {
      data: { workspace_name: `Outlets ${tag}`, display_name: "Oli Owner", email: `o${tag}@example.com`, username: `o${tag}`, password: PASSWORD },
    })).ok()).toBe(true);
    const outlets = await (await owner.request.post("/api/outlets", { data: { name: "Sri Gombak" } })).json();
    const gombak = outlets.find((o: { name: string }) => o.name === "Sri Gombak").id;
    expect((await owner.request.post("/api/users", {
      data: { username: `m${tag}`, display_name: "Mia Manager", role: "manager", password: PASSWORD, outlet_id: gombak },
    })).ok()).toBe(true);
    await owner.close();

    const context = await browser.newContext({ baseURL, ...testInfo.project.use });
    expect((await context.request.post("/api/auth/login", { data: { username: `m${tag}`, password: PASSWORD } })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("button", { name: "Outlet: Sri Gombak. Switch outlet" })).toBeVisible();
    await page.getByRole("button", { name: "Close the menu" }).click();

    await openPage(page, "Team");
    await page.getByRole("button", { name: "Add a person" }).tap();
    const add = async (who: string, username: string) => {
      await page.getByLabel("Name", { exact: true }).fill(who);
      await page.getByLabel("Username", { exact: true }).fill(username);
      await page.getByLabel("Starting password").fill(PASSWORD);
      await page.getByRole("button", { name: "Create account" }).tap();
      await expect(page.getByText("Account created.")).toBeVisible();
    };
    await add("Sam Staff", `s${tag}`);
    await expect(page.getByText(`s${tag} · Staff`)).toBeVisible();

    // She makes an assistant manager; only the owner makes full managers.
    const role = page.getByRole("combobox", { name: "Role", exact: true });
    await role.tap();
    await expect(page.getByRole("option")).toHaveText(["Staff", "Assistant manager"]);
    await page.getByRole("option", { name: "Assistant manager" }).tap();
    await add("Ada Assistant", `a${tag}`);
    await expect(page.getByText(`a${tag} · Assistant manager`)).toBeVisible();
    await expectFitsScreen(page);
    await context.close();
  });
});

test.describe("setup guide", () => {
  test("a new owner follows the checklist with the helper and finds Help & guides", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, ...testInfo.project.use });
    const tag = `${testInfo.project.name.replace(/\W/g, "")}${Date.now()}`;
    expect((await context.request.post("/api/auth/register", {
      data: { workspace_name: `Setup ${tag}`, display_name: "Nia New", email: `n${tag}@example.com`, username: `n${tag}`, password: PASSWORD },
    })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: `Let's set up Setup ${tag}` })).toBeVisible();
    await expect(page.getByText("0 of 5 done")).toBeVisible();
    await expectFitsScreen(page);

    // Show me opens the page; the helper talks it through and rings the storage areas.
    await page.getByRole("button", { name: "Show me: Set up your storage areas" }).tap();
    await expect(page.getByRole("heading", { name: "Categories & storage", level: 1 })).toBeVisible();
    const guide = page.getByRole("dialog", { name: "Setup guide: Set up your storage areas" });
    await expect(guide).toContainText("Every outlet starts with one called Store.");
    await expect(page.locator("section.guide-spot")).toHaveAttribute("aria-labelledby", "storage-heading");
    await guide.getByRole("button", { name: "Next" }).tap();
    await guide.getByRole("button", { name: "Next" }).tap();
    await guide.getByRole("button", { name: "Got it" }).tap();
    await expect(guide).toBeHidden();
    await expect(page.locator(".guide-spot")).toHaveCount(0);

    await openPage(page, "Help & guides");
    await expect(page.getByRole("heading", { name: "Outlets and plans" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
    await expectFitsScreen(page);
    await context.close();
  });
});

test.describe("stock insights", () => {
  test("a saved count shows what stands out, and purchase orders say why each amount", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, ...testInfo.project.use });
    const tag = `${testInfo.project.name.replace(/\W/g, "")}${Date.now()}`;
    const api = context.request;
    expect((await api.post("/api/auth/register", {
      data: { workspace_name: `Gaps ${tag}`, display_name: "Gia Owner", email: `g${tag}@example.com`, username: `g${tag}`, password: PASSWORD },
    })).ok()).toBe(true);
    const category = await (await api.post("/api/categories", { data: { name: "Dry" } })).json();
    const rice = await (await api.post("/api/products", { data: { name: "Rice", category_id: category.id, base_unit: "kg", min_stock: 5 } })).json();
    const today = new Date().toISOString().slice(0, 10);
    const count = (expected: number, counted: number) =>
      api.post("/api/stocktakes", { data: { count_date: today, lines: [{ product_id: rice.id, expected_stock: expected, counted_stock: counted }] } });
    expect((await count(0, 10)).ok()).toBe(true);
    expect((await count(10, 2)).ok()).toBe(true);
    await api.post("/api/suppliers", { data: { name: "Beras Co" } });

    const page = await context.newPage();
    await page.goto("/");
    await openPage(page, "Stock Count");
    await page.getByRole("button", { name: /ST-000002/ }).tap();
    const gaps = page.getByRole("region", { name: "What stands out" });
    await expect(gaps).toContainText("-8 kg");
    await expect(gaps).toContainText("One-off gap");
    await expect(gaps.getByRole("button", { name: "Explain with AI" })).toBeVisible();
    await expectFitsScreen(page);

    await openPage(page, "Purchase orders");
    await page.getByText(/Rice: \d+ kg/).tap();
    await expect(page.getByText(/Uses about [\d.]+ kg a day/)).toBeVisible();
    await expectFitsScreen(page);
    await context.close();
  });
});

test.describe("ask the helper", () => {
  test("a manager asks what to order and opens the details", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, ...testInfo.project.use });
    const tag = `${testInfo.project.name.replace(/\W/g, "")}${Date.now()}`;
    expect((await context.request.post("/api/auth/register", {
      data: { workspace_name: `Ask ${tag}`, display_name: "Ari Owner", email: `a${tag}@example.com`, username: `a${tag}`, password: PASSWORD },
    })).ok()).toBe(true);
    const category = await (await context.request.post("/api/categories", { data: { name: "Dry" } })).json();
    await context.request.post("/api/products", { data: { name: "Cooking oil", category_id: category.id, base_unit: "L", min_stock: 4 } });

    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Ask the helper" }).tap();
    const chat = page.getByRole("dialog", { name: "Ask the helper" });
    await chat.getByRole("button", { name: "What should we order?" }).tap();
    await expect(chat).toContainText("Cooking oil: 4 L. Below its minimum of 4 L.");
    await expectFitsScreen(page);
    await chat.getByRole("button", { name: "See the details" }).tap();
    await expect(chat).toBeHidden();
    await expect(page.getByRole("heading", { name: "Purchase orders", level: 1 })).toBeVisible();
    await context.close();
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
    await page.getByRole("button", { name: "Close this business" }).tap();
    const close = page.getByRole("button", { name: "I understand, close the business" });
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
    await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();
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

test.describe("sign-in page", () => {
  test("marks the way this browser last signed in", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByTestId("last-used")).toHaveCount(0);
    await page.getByLabel("Username or email").fill(PEOPLE.staff.username);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).tap();
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
    // Signing out of this browser only: other tests share the staff session cookie file, not this one.
    await page.request.post("/api/auth/logout");
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: "Sign in", exact: true }).getByTestId("last-used")).toHaveText("Last used");
    await expect(page.getByTestId("last-used")).toHaveCount(1);
  });
});

test.describe("dropdowns", () => {
  test.use({ storageState: stateFile("owner") });

  test("the site's own dropdown works by touch and by keyboard", async ({ page }, testInfo) => {
    await page.goto("/");
    await openPage(page, "Team");
    await page.getByRole("button", { name: "Add a person" }).tap();
    const role = page.getByRole("combobox", { name: "Role", exact: true });
    await expect(role).toHaveText("Staff");
    await role.tap();
    await expect(page.getByRole("option", { name: "Staff" })).toHaveAttribute("aria-selected", "true");
    await testInfo.attach("role dropdown open", { body: await page.screenshot(), contentType: "image/png" }); // fullPage would resize and close it
    await page.getByRole("option", { name: "Assistant manager" }).tap();
    await expect(role).toHaveText("Assistant manager");
    await expect(page.getByRole("listbox")).toBeHidden();

    await role.focus();
    await page.keyboard.press("ArrowDown"); // opens on the chosen one
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(role).toHaveText("Staff");
    await expect(role).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(role).toHaveText("Staff");
  });
});

test.describe("addresses", () => {
  test.use({ storageState: stateFile("owner") });

  test("each page has its own address: refresh, back and links work", async ({ page, browser }) => {
    await page.goto("/");
    // A random id, not a count of workspaces.
    await expect(page).toHaveURL(/\/w\/[0-9a-f]{12}\/dashboard$/);
    const ws = /\/w\/([0-9a-f]{12})\//.exec(page.url())![1];
    await openPage(page, "Delivery records");
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/records$`));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Delivery records" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/dashboard$`));
    await expect(page.locator("main h1:visible")).not.toHaveText("Delivery records");

    // Another workspace's id opens nothing of it: the same page, in the person's own workspace.
    await page.goto("/w/0123456789ab/records");
    await expect(page.getByText("That link is for a workspace you are not in")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/records$`));

    // Signed out, a link asks for sign-in and then opens where it pointed.
    const fresh = await browser.newContext({ baseURL: page.url().split("/w/")[0], storageState: { cookies: [], origins: [] } });
    const visitor = await fresh.newPage();
    await visitor.goto(`/w/${ws}/records`);
    await visitor.getByLabel("Username or email").fill(PEOPLE.owner.username);
    await visitor.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await visitor.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(visitor.getByRole("heading", { level: 1, name: "Delivery records" })).toBeVisible();
    await expect(visitor).toHaveURL(new RegExp(`/w/${ws}/records$`));
    await fresh.close();
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
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
  });

  test("the tablet itself stops being a kitchen tablet", async ({ page }) => {
    await page.request.post("/api/auth/login", { data: { username: PEOPLE.manager.username, password: PASSWORD } });
    expect((await page.request.post("/api/kitchen-devices", { data: { name: "Spare tablet" } })).status()).toBe(201);
    await page.request.post("/api/auth/logout");
    await page.goto("/signin");
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Stop using as a kitchen tablet" }).tap();
    await expect(page.getByText("Who's signing in?")).toBeHidden();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });
});
