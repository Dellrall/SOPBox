"""Pages for search engines and link previews: absolute URLs, robots.txt and the sitemap."""

from app import main


def test_robots_allows_the_site_hides_the_api_and_names_the_sitemap(anon):
    resp = anon.get("/robots.txt")
    assert resp.status_code == 200
    assert "Allow: /" in resp.text
    assert "Disallow: /api/" in resp.text
    assert "Sitemap: http://testserver/sitemap.xml" in resp.text


def test_the_sitemap_lists_the_public_page(anon):
    resp = anon.get("/sitemap.xml")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/xml")
    assert "<loc>http://testserver/</loc>" in resp.text


def test_the_page_gets_absolute_urls_for_previews(anon, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text('<link rel="canonical" href="__ORIGIN__/" />')
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)
    resp = anon.get("/")
    assert resp.status_code == 200
    assert resp.text == '<link rel="canonical" href="http://testserver/" />'
    assert resp.headers["cache-control"] == "no-cache"
    # The security headers still apply to the page itself.
    assert "frame-ancestors 'none'" in resp.headers["content-security-policy"]


def test_a_forged_host_cannot_inject_markup(anon, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text('<a href="__ORIGIN__/">')
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)
    resp = anon.get("/", headers={"host": 'evil"><script>x</script>'})
    assert "<script>" not in resp.text


def test_pages_and_data_are_compressed(anon, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<p>app</p>" * 500)
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)
    resp = anon.get("/", headers={"accept-encoding": "gzip"})
    assert resp.headers["content-encoding"] == "gzip" and resp.text.startswith("<p>app</p>")
    assert "frame-ancestors 'none'" in resp.headers["Content-Security-Policy"]


def test_sign_in_and_register_addresses_serve_the_app(anon, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("app")
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)
    for path in ("/signin", "/register", "/settings"):
        assert anon.get(path).text == "app"
