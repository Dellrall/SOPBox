"""What search engines and link previews see for each public page, before any script runs: its
title, description and canonical address, and a short summary in the page body. The frontend sets
the same title and description when moving between pages (usePageMeta in Site.tsx)."""

import html
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Page:
    title: str
    description: str
    summary: str  # one paragraph under the heading, shown until the app loads


PAGES = {
    "/pricing": Page(
        "Pricing · SOPBox",
        "SOPBox pricing: free for one store, Pro priced per extra outlet by the year or once for life, and Enterprise plans "
        "for groups. Add customization and priority support.",
        "Free for one store, with your whole team and every receiving check. Pro adds outlets, HQ and branch links and till "
        "API keys, priced per extra outlet for a year or once for life. Enterprise is one price for your whole group.",
    ),
    "/docs": Page(
        "Docs · SOPBox",
        "How to use SOPBox: set up your outlet, products and team, check deliveries as they arrive, count stock, and run "
        "more than one outlet with outlet managers on Pro and Enterprise.",
        "Guides for every part of SOPBox: setting up, receiving checks, approvals, purchase orders, stock counts, your team "
        "and their roles, and running several outlets.",
    ),
    "/privacy": Page(
        "Privacy · SOPBox",
        "How SOPBox collects, uses, shares and protects personal data, how long it is kept, and how to download or delete "
        "it, in line with Malaysia's Personal Data Protection Act.",
        "What SOPBox collects, why, who else handles it, how long it is kept, and the rights you have over it.",
    ),
    "/contact": Page(
        "Contact · SOPBox",
        "Ask the SOPBox team a question or talk to sales about plans for more outlets and groups. Leave your details and "
        "we will get back to you.",
        "Ask a question or talk to sales. Leave your details and the SOPBox team will get back to you.",
    ),
}

# The parts of index.html that change per page. The defaults there describe the home page.
_TITLE = re.compile(r"<title>.*?</title>", re.S)
_DESCRIPTION = re.compile(r'(<meta\s+name="description"\s+content=")[^"]*(")', re.S)
_OG_TITLE = re.compile(r'(<meta property="og:title" content=")[^"]*(")')
_OG_DESCRIPTION = re.compile(r'(<meta\s+property="og:description"\s+content=")[^"]*(")', re.S)
_SUMMARY = re.compile(r"<!--page-->.*?<!--/page-->", re.S)


def render(template: str, path: str, origin: str) -> str:
    """index.html for this address, with absolute URLs (link previews and canonical links need them)."""
    page = PAGES.get(path)
    body = template
    if page:
        title, description = html.escape(page.title), html.escape(page.description)
        body = _TITLE.sub(lambda _: f"<title>{title}</title>", body, count=1)
        body = _DESCRIPTION.sub(lambda m: m[1] + description + m[2], body, count=1)
        body = _OG_TITLE.sub(lambda m: m[1] + title + m[2], body, count=1)
        body = _OG_DESCRIPTION.sub(lambda m: m[1] + description + m[2], body, count=1)
        body = _SUMMARY.sub(
            lambda _: f'<main class="mx-auto my-12 max-w-2xl px-4"><h1 class="text-2xl font-bold text-brand-950">{title}</h1>'
            f'<p class="mt-3 text-muted">{html.escape(page.summary)}</p></main>',
            body,
            count=1,
        )
        body = body.replace('href="__ORIGIN__/"', f'href="__ORIGIN__{path}"').replace(
            'content="__ORIGIN__/"', f'content="__ORIGIN__{path}"'
        )
    return body.replace("__ORIGIN__", html.escape(origin))


def sitemap(origin: str) -> str:
    urls = "".join(f"<url><loc>{html.escape(origin)}{path}</loc></url>" for path in ["/", *PAGES])
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n'
