"""The assistant: a chat on the AI_* service that walks people through the app's work.

The model only writes words. Every number it may quote comes from a tool below, and each tool is
a fixed query (or ask.py's answers) run with the asker's access. It changes nothing: to act, it
offers buttons that open the page where a person does the step. Each question is one AI use.
"""

import json
import logging
from datetime import date

import httpx
import psycopg

from app import ask, auth, locations, lots, plans, reports, sales_ai
from app.auth import CurrentUser
from app.config import get_settings
from app.errors import ExtractionError, InvalidRequestError, NotFoundError
from app.models import AskAnswer, AssistantIn, AssistantOut, PageLink, ReportFilter

logger = logging.getLogger(__name__)

MAX_ROUNDS = 4  # model calls per question, so a loop cannot spend the allowance
MAX_TOOL_TEXT = 3000

# Pages a button may open: (label, section needed or None, managers only, what is done there).
PAGES = {
    "dashboard": ("Dashboard", "dashboard", False, "today's numbers, low stock, recent deliveries"),
    "tasks": ("Tasks", None, False, "jobs with a person in charge, daily checklists"),
    "purchasing": ("Purchase orders", "purchasing", False, "draft orders from low stock, send them to suppliers"),
    "receive": ("Receiving check", "receive", False, "photograph a delivery order, check temperature, packs and expiry"),
    "approvals": ("Approvals", "approvals", False, "accept, send back or reject deliveries that failed a check"),
    "records": ("Order records", "records", False, "every delivery received, with photos and results"),
    "stocktake": ("Stock Count", "stocktake", False, "count the shelf; the difference shows what went missing"),
    "stock": ("Stock & sales", "stocktake", False, "stock per storage area, transfers, take sales off stock"),
    "expiry": ("Expiry dates", "stocktake", False, "lots by expiry date, throw away or donate what expired"),
    "products": ("Products & SOP", "products", False, "products, pack sizes, codes, checks and SOP cards"),
    "categories": ("Categories & storage", "products", False, "categories with temperature ranges, storage areas"),
    "reports": ("Reports", None, True, "reports by period, product, supplier or storage area, CSV and print"),
    "help": ("Help & guides", None, False, "step-by-step guides for every page"),
}

SYSTEM = """You are SOPBox's assistant for a food and beverage outlet. Staff may read English or Malay as a
second language: answer in the language of the question, in short plain sentences, at most about 80 words.
Guide people through the work: ordering, receiving checks, approvals, stock counts, sales, expiry, reports.
Rules:
- Use the tools for any fact about this business. Never guess or work out numbers yourself; quote the numbers
  a tool gave, as written. If no tool has it, say you do not know.
- You cannot change anything. To get something done, explain the steps briefly and call open_page so a
  button takes them there. Never say a thing was done.
- Today is {today}. Pages: {pages}."""


def _pages_for(user: CurrentUser) -> dict[str, tuple]:
    manager = user.role in ("owner", "manager")
    return {
        page: info for page, info in PAGES.items()
        if (manager or not info[2]) and (info[1] is None or auth.can_access_section(user, info[1]))
    }


def _tools(pages: dict[str, tuple], manager: bool) -> list[dict]:
    def tool(name: str, description: str, properties: dict | None = None, required: list[str] | None = None) -> dict:
        return {"type": "function", "function": {
            "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties or {}, "required": required or []}}}

    out = [
        tool("records", "Answers worked out from the records: waste = what went missing at stock counts; reorder = "
             "what to order; prices = delivered prices that moved; approvals = deliveries waiting for a manager; "
             "use = how fast a product is used and how long stock lasts.",
             {"topic": {"type": "string", "enum": list(ask.TOPICS)},
              "product": {"type": "string", "description": "for use: the product name"},
              "days": {"type": "integer", "description": "for waste: how many days back"}}, ["topic"]),
        tool("stock", "Stock of products whose name contains the words, per storage area of the outlet worked in.",
             {"name": {"type": "string"}}, ["name"]),
        tool("expiring", "Lots that expired or expire soon, earliest first, with what is left."),
        tool("open_page", "Show the person a button that opens a page, to do the next step there.",
             {"page": {"type": "string", "enum": list(pages)},
              "label": {"type": "string", "description": "short button text, e.g. Draft the order"}}, ["page"]),
    ]
    if manager:
        out.append(tool(
            "report", "A report with totals worked out in code. Kinds: " + ", ".join(reports.REPORTS) + ", expiry.",
            {"kind": {"type": "string", "enum": [*reports.REPORTS, "expiry"]},
             "date_from": {"type": "string", "description": "YYYY-MM-DD"},
             "date_to": {"type": "string", "description": "YYYY-MM-DD"},
             "supplier": {"type": "string"}}, ["kind"]))
    return out


def _answer_text(a: AskAnswer) -> str:
    return " ".join([a.text, *(f"- {item}" for item in a.items)])


def _run(conn: psycopg.Connection, user: CurrentUser, pages: dict, name: str, args: dict, links: list[PageLink]) -> str:
    """One tool call, with the asker's access. Its text goes back to the model."""
    ws = user.workspace_id
    if name == "records":
        topic = args.get("topic")
        if topic not in ask.TOPICS:
            return "unknown topic"
        if not auth.can_access_section(user, ask.SECTION[topic]):
            return "the person has no access to this"
        if topic == "waste":
            days = args.get("days")
            return _answer_text(ask._waste(conn, ws, days if isinstance(days, int) and 0 < days <= 366 else 30))
        if topic == "reorder":
            return _answer_text(ask._reorder(conn, ws))
        if topic == "prices":
            return _answer_text(ask._prices(conn, ws))
        if topic == "approvals":
            return _answer_text(ask._approvals(conn, ws))
        product = str(args.get("product") or "")
        return _answer_text(ask._use(conn, ws, product, product or None))
    if name == "stock":
        if not auth.can_access_section(user, "stocktake"):
            return "the person has no access to stock"
        words = str(args.get("name") or "").strip()[:60]
        rows = conn.execute(
            f"SELECT p.name, p.base_unit, {locations.LABEL_SQL} AS place, l.quantity FROM stock_levels l "
            "JOIN products p ON p.id = l.product_id JOIN storages s ON s.id = l.storage_id "
            "JOIN outlets o ON o.id = s.outlet_id "
            f"WHERE p.workspace_id = %s AND NOT p.archived AND p.name ILIKE %s AND {locations.mine('l.storage_id')} "
            "ORDER BY lower(p.name), place LIMIT 30",
            (ws, f"%{words}%"),
        ).fetchall()
        return "; ".join(f"{r['name']} at {r['place']}: {r['quantity']} {r['base_unit']}" for r in rows) or "no product found"
    if name == "expiring":
        if not auth.can_access_section(user, "stocktake"):
            return "the person has no access to expiry dates"
        near = [lot for lot in lots.list_lots(conn, ws) if lot.status in ("expired", "soon", "no_date") and lot.left > 0]
        return "; ".join(
            f"{lot.code} {lot.product} at {lot.location}: {lot.left} {lot.base_unit} left, "
            + ("no date yet" if lot.expiry_on is None else f"{lot.status}, expires {lot.expiry_on}")
            for lot in near[:20]
        ) or "nothing expired or expiring soon"
    if name == "open_page":
        page = args.get("page")
        if page not in pages:
            return "the person cannot open that page"
        label = str(args.get("label") or "").strip()[:40] or f"Open {pages[page][0]}"
        if not any(link.page == page for link in links):
            links.append(PageLink(page=page, label=label))
        return "button shown"
    if name == "report" and user.role in ("owner", "manager"):
        try:
            f = ReportFilter(date_from=args.get("date_from") or None, date_to=args.get("date_to") or None,
                             supplier=args.get("supplier") or None)
            out = reports.build(conn, ws, args.get("kind"), f)
        except (InvalidRequestError, NotFoundError, ValueError, KeyError) as exc:
            return f"report failed: {exc}"
        return json.dumps({"title": out.title, "rows": len(out.rows), "totals": out.totals,
                           "first_rows": out.rows[:8], "money_is_in_sen": True}, default=str)
    return "unknown tool"


def _call(messages: list[dict], tools: list[dict]) -> dict:
    """One model turn. The key never leaves the server and is never logged."""
    settings = get_settings()
    sales_ai._take_budget()
    try:
        resp = httpx.post(
            f"{settings.ai_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {settings.ai_api_key}"},
            json={"model": settings.ai_model, "messages": messages, "tools": tools, "max_completion_tokens": 800},
            timeout=60,
        )
    except httpx.HTTPError:
        raise ExtractionError("could not reach the AI service; try again") from None
    if resp.status_code >= 400:
        logger.warning("assistant AI answered %s", resp.status_code)
        raise ExtractionError(f"the AI service refused the request ({resp.status_code}); try again")
    try:
        return resp.json()["choices"][0]["message"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise ExtractionError("the AI service gave an empty answer; try again") from None


def chat(conn: psycopg.Connection, user: CurrentUser, data: AssistantIn) -> AssistantOut:
    if not get_settings().ai_api_key:
        # No AI service: the fixed questions still answer.
        a = ask.answer(conn, user, data.messages[-1].content)
        return AssistantOut(text=_answer_text(a), links=[PageLink(page=a.to, label="See the details")] if a.to else [])
    pages = _pages_for(user)
    manager = user.role in ("owner", "manager")
    tools = _tools(pages, manager)
    system = SYSTEM.format(today=date.today().isoformat(), pages="; ".join(f"{k} = {v[0]}: {v[3]}" for k, v in pages.items()))
    messages = [{"role": "system", "content": system}, *({"role": m.role, "content": m.content} for m in data.messages)]
    links: list[PageLink] = []

    def converse() -> str:
        for _ in range(MAX_ROUNDS):
            reply = _call(messages, tools)
            calls = (reply.get("tool_calls") or [])[:6]
            if not calls:
                return str(reply.get("content") or "").strip()
            messages.append({"role": "assistant", "content": reply.get("content"), "tool_calls": calls})
            for call in calls:
                fn = call.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except ValueError:
                    args = {}
                result = _run(conn, user, pages, str(fn.get("name")), args if isinstance(args, dict) else {}, links)
                messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": result[:MAX_TOOL_TEXT]})
        return "That took too many steps. Ask again in a shorter way."

    text = plans.metered(conn, user.workspace_id, "assistant", converse)
    return AssistantOut(text=text or "Sorry, I have no answer to that.", links=links[:3])
