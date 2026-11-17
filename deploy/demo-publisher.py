"""Loopback publisher for Nexy demo owners. No public management API.

Anyone with the demo code can publish, so a page is only ever what Own Build
generated for that build (fetched here, never taken from the browser), and it
expires after PUBLISH_TTL_HOURS.
"""
import json
import os
import re
import secrets
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

OUT = os.environ["SITES_DIR"]
SITES = os.environ["SITES_URL"].rstrip("/")
NAME = re.compile(r"[a-z0-9][a-z0-9-]{1,40}")
RUN = re.compile(r"[A-Za-z0-9_-]{1,64}")
OWNER = re.compile(r"o_[a-z0-9]{1,12}_[a-f0-9]{16}")
LOCK = threading.RLock()
BUILD = os.environ.get("OWN_BUILD_URL", "http://127.0.0.1:4372").rstrip("/")
# Own Build in its own container wants a service token; read per call, so a rotation needs no restart
BUILD_TOKEN_FILE = os.environ.get("OWN_BUILD_TOKEN_FILE", "")
TTL = float(os.environ.get("PUBLISH_TTL_HOURS", "6")) * 3600
MAX_PER_OWNER = int(os.environ.get("PUBLISH_MAX_PER_OWNER", "3"))


def live_count(owner):
    n = 0
    for f in os.listdir(OUT):
        if not f.endswith(".json"):
            continue
        try:
            with open(os.path.join(OUT, f)) as src:
                p = json.load(src)
            n += p.get("owner") == owner and float(p.get("expires", 0)) > time.time()
        except (OSError, ValueError, TypeError):
            continue
    return n


def build_headers():
    if not BUILD_TOKEN_FILE:
        return {}
    try:
        with open(BUILD_TOKEN_FILE) as f:
            token = f.read().strip()
    except OSError as e:
        print(f"OWN_BUILD_TOKEN_FILE unreadable ({type(e).__name__}); calling without a token", flush=True)
        return {}
    return {"Authorization": f"Bearer {token}"} if token else {}


REFUSED = object()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib carries Authorization to any host a redirect names; with a token, follow none
    def redirect_request(self, *args, **kwargs):
        return None


_PLAIN = urllib.request.build_opener()
_GUARDED = urllib.request.build_opener(_NoRedirect)


def built_page(run):
    """The page Own Build generated for this run, None, or REFUSED (its service token was turned away)."""
    headers = build_headers()
    req = urllib.request.Request(f"{BUILD}/api/director/runs/{quote(run)}/preview", headers=headers)
    try:
        with (_GUARDED if headers else _PLAIN).open(req, timeout=30) as r:
            page = r.read(5_000_001)
    except urllib.error.HTTPError as e:
        print(f"no build page for {run}: Own Build answered {e.code}", flush=True)
        return REFUSED if e.code == 401 and BUILD_TOKEN_FILE else None
    except OSError as e:
        print(f"no build page for {run}: {e}", flush=True)
        return None
    return page if len(page) <= 5_000_000 and b"<" in page[:2000] else None


def remove(name):
    for ext in (".html", ".json"):
        try:
            os.unlink(os.path.join(OUT, name + ext))
        except FileNotFoundError:
            pass


def sweep():
    """Unpublish pages past their expiry."""
    now = time.time()
    with LOCK:
        for f in os.listdir(OUT):
            if not f.endswith(".json"):
                continue
            try:
                with open(os.path.join(OUT, f)) as src:
                    p = json.load(src)
                if float(p.get("expires", 0)) <= now:
                    remove(f[:-5])
                    print(f"expired {f[:-5]}", flush=True)
            except (OSError, ValueError, TypeError):
                continue


def sweeper():
    while True:
        sweep()
        time.sleep(60)


def entries(owner, run):
    result = []
    for f in sorted(os.listdir(OUT)):
        if not f.endswith(".json"):
            continue
        try:
            with open(os.path.join(OUT, f)) as src:
                p = json.load(src)
            if (p.get("owner") == owner and p.get("run") == run
                    and NAME.fullmatch(p.get("name", ""))
                    and float(p.get("expires", 0)) > time.time()
                    and os.path.isfile(os.path.join(OUT, p["name"] + ".html"))):
                result.append({"name": p["name"], "run": run, "url": SITES + "/" + p["name"],
                               "expiresAt": int(float(p["expires"]) * 1000)})
        except (OSError, ValueError, TypeError):
            continue
    return result


def write(name, data):
    fd, temp = tempfile.mkstemp(dir=OUT, prefix=".publishing-")
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        os.chmod(temp, 0o644)
        os.replace(temp, os.path.join(OUT, name))
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        owner = self.headers.get("x-nexy-owner", "")
        run = parse_qs(url.query).get("run", [""])[0]
        if not OWNER.fullmatch(owner):
            return self.send(403, {"error": "owner required"})
        if url.path != "/publish/api/status" or not RUN.fullmatch(run):
            return self.send(400, {"error": "bad status request"})
        with LOCK:
            self.send(200, {"publications": entries(owner, run)})

    def do_POST(self):
        owner = self.headers.get("x-nexy-owner", "")
        if not OWNER.fullmatch(owner):
            return self.send(403, {"error": "owner required"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 15_000_000:
                return self.send(413, {"error": "request too large"})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or not RUN.fullmatch(str(body.get("run", ""))):
                return self.send(400, {"error": "bad run"})
        except (ValueError, TypeError):
            return self.send(400, {"error": "bad JSON"})
        run = body["run"]
        with LOCK:
            if self.path == "/publish/api/publish":
                existing = entries(owner, run)
                if existing:
                    return self.send(200, existing[0])
                name = body.get("name") or secrets.token_hex(6)
                if not isinstance(name, str) or not NAME.fullmatch(name):
                    return self.send(400, {"error": "invalid website name"})
                if any(os.path.exists(os.path.join(OUT, name + ext)) for ext in (".html", ".json")):
                    return self.send(409, {"error": "website name already in use"})
                if live_count(owner) >= MAX_PER_OWNER:
                    return self.send(429, {"error": f"You already have {MAX_PER_OWNER} public websites. Unpublish one, or wait for one to expire."})
                # body["html"] is ignored: the browser could send any page at all
                page = built_page(run)
                if page is REFUSED:
                    return self.send(502, {"error": "Own Build turned the publisher away: its service key on this Own 1 is missing or out of date."})
                if page is None:
                    return self.send(422, {"error": "Own Build has no finished website for this build"})
                expires = time.time() + TTL
                write(name + ".json", json.dumps({"owner": owner, "run": run, "name": name, "expires": expires}).encode())
                write(name + ".html", page)
                return self.send(200, {"url": SITES + "/" + name, "expiresAt": int(expires * 1000)})
            if self.path == "/publish/api/unpublish":
                name = body.get("name")
                if not isinstance(name, str) or not any(p["name"] == name for p in entries(owner, run)):
                    return self.send(404, {"error": "no publication for this owner and build"})
                remove(name)
                return self.send(200, {"ok": True})
            return self.send(404, {"error": "not found"})


if __name__ == "__main__":
    threading.Thread(target=sweeper, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("PORT", "4390"))), Handler).serve_forever()
