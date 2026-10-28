# -*- coding: utf-8 -*-
"""今昔対照をブラウザで開くためのローカルサーバー。"""

import mimetypes
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "web"
HOST = "127.0.0.1"
ALLOWED_HOSTS = {
    "ktgis.net",
    "cyberjapandata.gsi.go.jp",
    "msearch.gsi.go.jp",
    "tile.openstreetmap.org",
}


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urllib.parse.urlparse(newurl).hostname
        if host not in ALLOWED_HOSTS:
            raise urllib.error.HTTPError(newurl, 403, "redirect blocked", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(_SafeRedirect)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if len(args) >= 2 and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/proxy":
            self._proxy(parsed)
            return
        rel = parsed.path
        if rel in ("", "/"):
            rel = "/index.html"
        file = (ROOT / rel.lstrip("/")).resolve()
        if not file.is_relative_to(ROOT) or not file.is_file():
            self.send_error(404)
            return
        data = file.read_bytes()
        ctype = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        if file.suffix in {".js", ".html", ".css"}:
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _proxy(self, parsed):
        target = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
        host = urllib.parse.urlparse(target).hostname or ""
        if host not in ALLOWED_HOSTS or not target.startswith("https://"):
            self.send_error(403)
            return
        req = urllib.request.Request(target, headers={"User-Agent": "konjaku-taisho/1.0"})
        try:
            with OPENER.open(req, timeout=25) as res:
                body = res.read()
                ctype = res.headers.get("Content-Type", "application/octet-stream")
        except urllib.error.HTTPError as exc:
            self.send_response(exc.code)
            self.end_headers()
            return
        except Exception:
            self.send_error(502)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(body)


def main():
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    httpd = None
    port = None
    for candidate in range(8756, 8770):
        try:
            httpd = ThreadingHTTPServer((HOST, candidate), Handler)
            port = candidate
            break
        except OSError:
            continue
    if httpd is None:
        raise SystemExit("ポート 8756–8769 を開けませんでした。")
    url = f"http://{HOST}:{port}/"
    print(f"今昔対照を開いています: {url}")
    print("終了するときは、この窓で Ctrl+C を押してください。")
    threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n終了しました。")
        httpd.shutdown()


if __name__ == "__main__":
    main()
