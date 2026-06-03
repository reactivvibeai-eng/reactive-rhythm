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

    def log_message(self, *args):
        pass  # quiet


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer((HOST, PORT), NoCacheHandler) as httpd:
    print("Reactive Rhythm (no-cache) serving on http://%s:%d" % (HOST, PORT))
    httpd.serve_forever()
