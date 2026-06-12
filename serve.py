#!/usr/bin/env python3
"""Tiny localhost dev server that sends no-cache headers, so the browser ALWAYS
fetches the latest files on a normal refresh (no hard-refresh needed). Test build only.

    python serve.py            # serves this folder on http://127.0.0.1:8787
"""
import http.server
import socketserver

PORT = 8787
HOST = "127.0.0.1"  # localhost only — never exposes the project to the network


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def do_POST(self):
        # DEV CAPTURE SINK (test build only — strip with the other dev hooks): the headless
        # verifier POSTs canvas dataURLs to /__cap so proof shots never ride lossy transcription.
        if self.path.startswith("/__cap"):
            import base64, re
            n = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n).decode("utf-8", "replace")
            m = re.match(r"data:image/(\w+);base64,(.*)", body, re.S)
            name = self.path.split("=")[-1] if "=" in self.path else "cap"
            ext = m.group(1) if m else "bin"
            data = base64.b64decode(m.group(2)) if m else body.encode()
            with open("_cap_%s.%s" % (name, "jpg" if ext == "jpeg" else ext), "wb") as f:
                f.write(data)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass  # quiet


socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.daemon_threads = True
with socketserver.ThreadingTCPServer((HOST, PORT), NoCacheHandler) as httpd:
    print("Reactive Rhythm (no-cache, threaded) serving on http://%s:%d" % (HOST, PORT))
    httpd.serve_forever()
