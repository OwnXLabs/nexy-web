"""A stand-in for the private (single-owner) publisher, for tests/publishing.cjs.

It speaks the same API Nexy calls (src/pages/api/v1/publish.ts): status, publish and
unpublish under /publish/api/. A page is the snapshot Nexy sends, or Own Build's page for
the run when there is none. Names are kept on disk so they survive a restart. Errors are
plain text, as the private publisher answers. Set NEXY_PUBLISHER_SCRIPT to test the real one.
"""
import json
import os
import re
import secrets
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

OUT = os.environ["SITES_DIR"]
SITES = os.environ["SITES_URL"].rstrip("/")
BUILD = os.environ.get("OWN_BUILD_URL", "").rstrip("/")
NAME = re.compile(r"[a-z0-9][a-z0-9-]{1,40}")
RUN = re.compile(r"[A-Za-z0-9_-]{1,64}")


def meta(name):
    try:
        with open(os.path.join(OUT, name + ".pub")) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def listed(run):
    out = []
    for f in sorted(os.listdir(OUT)):
        if f.endswith(".pub"):
            p = meta(f[:-4])
            if p and p.get("run") == run and os.path.isfile(os.path.join(OUT, p["name"] + ".html")):
                out.append({"name": p["name"], "run": run, "url": SITES + "/" + p["name"]})
    return out


def remove(name):
    for ext in (".html", ".pub"):
        try:
            os.unlink(os.path.join(OUT, name + ext))
        except FileNotFoundError:
            pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, body):
        data = (json.dumps(body) if isinstance(body, dict) else body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json" if isinstance(body, dict) else "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        run = parse_qs(url.query).get("run", [""])[0]
        if url.path != "/publish/api/status" or not RUN.fullmatch(run):
            return self.reply(400, "bad status request")
        self.reply(200, {"publications": listed(run)})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        except ValueError:
            return self.reply(400, "bad JSON")
        name, run = body.get("name") or "", body.get("run")
        if self.path == "/publish/api/publish":
            if not RUN.fullmatch(str(run)):
                return self.reply(400, "bad run")
            name = name or secrets.token_hex(6)
            if not NAME.fullmatch(name):
                return self.reply(400, "invalid website name")
            held = meta(name)
            if held and held.get("run") != run:
                return self.reply(409, "website name already in use")
            page = body.get("html")
            if not page:
                with urllib.request.urlopen(f"{BUILD}/api/director/runs/{quote(run)}/preview", timeout=30) as r:
                    page = r.read().decode()
            with open(os.path.join(OUT, name + ".html"), "w") as f:
                f.write(page)
            with open(os.path.join(OUT, name + ".pub"), "w") as f:
                json.dump({"name": name, "run": run}, f)
            return self.reply(200, SITES + "/" + name)
        if self.path == "/publish/api/unpublish":
            held = meta(name) if NAME.fullmatch(name) else None
            if not held:
                return self.reply(404, "no such website")
            # Nexy names the run; the standalone management page does not
            if run is not None and held.get("run") != run:
                return self.reply(409, "that website belongs to another build")
            remove(name)
            return self.reply(200, "unpublished")
        self.reply(404, "not found")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(os.environ["PORT"])), Handler).serve_forever()
