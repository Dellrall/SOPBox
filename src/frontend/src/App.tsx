import { useState } from "react";
import Approvals from "./Approvals";
import Catalogue from "./Catalogue";
import Receive from "./Receive";

const TABS = [
  { id: "receive", label: "Receive" },
  { id: "approvals", label: "Approvals" },
  { id: "catalogue", label: "Catalogue" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("receive");

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 pt-3">
        <h1 className="text-lg font-semibold text-teal-800">
          SopBox <span className="font-normal text-slate-500">Receiving check</span>
        </h1>
        <nav className="mt-2 flex gap-1" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.id ? "border-teal-700 text-teal-800" : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="p-4">
        {/* Receive stays mounted so a half-filled delivery survives a look at another tab. */}
        <div hidden={tab !== "receive"}>
          <Receive />
        </div>
        {tab === "approvals" && <Approvals />}
        {tab === "catalogue" && <Catalogue />}
      </main>
    </div>
  );
}
