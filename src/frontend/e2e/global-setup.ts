import { request, type FullConfig } from "@playwright/test";

/** One workspace for the whole run, built through the API, and a signed-in browser state per role. */
export const PASSWORD = "correct horse battery";
export const PEOPLE = {
  owner: { username: "olive", name: "Olive Owner" },
  manager: { username: "mia", name: "Mia Manager" },
  staff: { username: "sam", name: "Sam Staff" },
} as const;
export type Person = keyof typeof PEOPLE;
export const STAFF_PIN = "2468";
export const stateFile = (who: Person) => `e2e/.auth/${who}.json`;

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const ok = async (resp: Awaited<ReturnType<Awaited<ReturnType<typeof request.newContext>>["post"]>>) => {
    if (!resp.ok()) throw new Error(`${resp.url()} ${resp.status()}: ${await resp.text()}`);
    return resp.json().catch(() => null);
  };

  const owner = await request.newContext({ baseURL });
  const existing = await owner.post("/api/auth/login", { data: { username: PEOPLE.owner.username, password: PASSWORD } });
  if (!existing.ok()) {
    // A fresh server: create the workspace, the team and a small catalogue.
    await ok(
      await owner.post("/api/auth/register", {
        data: { workspace_name: "Kopi Corner", display_name: PEOPLE.owner.name, email: "olive@example.com", username: PEOPLE.owner.username, password: PASSWORD },
      }),
    );
    for (const role of ["manager", "staff"] as const) {
      const p = PEOPLE[role];
      await ok(await owner.post("/api/users", { data: { username: p.username, display_name: p.name, role, password: PASSWORD } }));
    }
    const categories: Record<string, number> = {};
    for (const [name, range] of [["Chiller", [0, 5]], ["Frozen", [-20, -10]], ["Room", null], ["Packaging", null]] as const) {
      const body = range ? { name, temp_min_c: range[0], temp_max_c: range[1] } : { name };
      categories[name] = (await ok(await owner.post("/api/categories", { data: body }))).id;
    }
    const products: [string, string, Record<string, unknown>][] = [
      ["Fresh milk 1L", "Chiller", { base_unit: "btl", min_stock: 12 }],
      ["Frozen chicken sausage, extra long name to test wrapping", "Frozen", { base_unit: "pcs", min_stock: 50 }],
      ["Frozen fries 2kg", "Frozen", { base_unit: "pkt" }],
      ["Arabica beans 1kg", "Room", { base_unit: "pkt", sop: "Check the roast date. Reject if older than 30 days." }],
      ["Paper cup 12oz", "Packaging", { base_unit: "pcs", pack_units: [{ unit: "sleeve", base_qty: 50 }, { unit: "ctn", base_qty: 1000 }] }],
    ];
    for (const [name, category, rest] of products)
      await ok(await owner.post("/api/products", { data: { name, category_id: categories[category], ...rest } }));
  }
  await owner.storageState({ path: stateFile("owner") });
  await owner.dispose();

  for (const who of ["manager", "staff"] as const) {
    const ctx = await request.newContext({ baseURL });
    await ok(await ctx.post("/api/auth/login", { data: { username: PEOPLE[who].username, password: PASSWORD } }));
    if (who === "staff") await ctx.put("/api/auth/pin", { data: { pin: STAFF_PIN } });
    await ctx.storageState({ path: stateFile(who) });
    await ctx.dispose();
  }
}
