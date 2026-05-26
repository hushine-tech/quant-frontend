#!/usr/bin/env python3
import argparse
import http.server
import os
import socketserver
import urllib.parse


class SpaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def send_head(self):
        parsed = urllib.parse.urlparse(self.path)
        requested_path = parsed.path
        translated = self.translate_path(requested_path)
        basename = os.path.basename(requested_path)
        if not os.path.exists(translated) and "." not in basename:
            self.path = "/index.html"
        return super().send_head()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve a Vite SPA build with history fallback.")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--directory", default="dist")
    args = parser.parse_args()

    handler = lambda *h_args, **h_kwargs: SpaHandler(*h_args, directory=args.directory, **h_kwargs)
    with socketserver.TCPServer((args.bind, args.port), handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
