/**
 * The UN Sustainable Development Goals SOPBox supports (see 1st_proposal.md, section 9).
 * Icons are the official UN ones, resized only: © United Nations, from un.org/sustainabledevelopment.
 */
/** Goal statements and target wording are the UN's own, quoted from each goal's page at `url`. */
export const SDGS = [
  {
    goal: 12,
    title: "Responsible consumption and production",
    statement: "Ensure sustainable consumption and production patterns.",
    icon: "/sdg-12.webp",
    url: "https://www.un.org/sustainabledevelopment/sustainable-consumption-production/",
    targets: [
      {
        id: "12.3",
        text: "By 2030, halve per capita global food waste at the retail and consumer levels and reduce food losses along production and supply chains, including post-harvest losses.",
        fit: "Bad deliveries are stopped at the door, so spoiled or wrong stock goes back to the supplier instead of into the bin later.",
      },
      {
        id: "12.5",
        text: "By 2030, substantially reduce waste generation through prevention, reduction, recycling and reuse.",
        fit: "Stock counts and low-stock purchase orders help you buy only what you need, so less goes off on the shelf.",
      },
    ],
  },
  {
    goal: 8,
    title: "Decent work and economic growth",
    statement: "Promote inclusive and sustainable economic growth, employment and decent work for all.",
    icon: "/sdg-08.webp",
    url: "https://www.un.org/sustainabledevelopment/economic-growth/",
    targets: [
      {
        id: "8.2",
        text: "Achieve higher levels of economic productivity through diversification, technological upgrading and innovation, including through a focus on high-value added and labour-intensive sectors.",
        fit: "AI reads the delivery order and a one-minute phone check replaces paper logs in a labour-intensive kitchen.",
      },
      {
        id: "8.3",
        text: "Promote development-oriented policies that support productive activities, decent job creation, entrepreneurship, creativity and innovation, and encourage the formalization and growth of micro-, small- and medium-sized enterprises, including through access to financial services.",
        fit: "Small F&B businesses get a proper receiving system, with an audit trail, that runs on the phones they already have.",
      },
      {
        id: "8.5",
        text: "By 2030, achieve full and productive employment and decent work for all women and men, including for young people and persons with disabilities, and equal pay for work of equal value.",
        fit: "SOP cards and step-by-step checks let new and young staff do the job right from day one.",
      },
    ],
  },
];

export const SDG_CREDIT = "SDG icons © United Nations, from un.org/sustainabledevelopment.";

/** A one-line strip for the bottom of every page. */
export function SdgFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted print:hidden ${className}`}>
      <span className="font-semibold text-ink">Supports the UN Sustainable Development Goals</span>
      <span className="flex gap-1.5">
        {SDGS.map((s) => (
          <a key={s.goal} href={s.url} target="_blank" rel="noreferrer" title={`SDG ${s.goal}: ${s.title}`}>
            <img src={s.icon} alt={`SDG ${s.goal}: ${s.title}`} width={32} height={32} loading="lazy" className="h-8 w-8 rounded-sm" />
          </a>
        ))}
      </span>
      <span>{SDG_CREDIT}</span>
    </footer>
  );
}
