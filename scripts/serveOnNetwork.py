"""Serve the tracker to other devices on your network, for example, to test it on a phone.

Serves the repo root on every network interface and prints the address to open
on the external device, which has to be on the same Wi-Fi. Stop it with Ctrl+C. See
README.md, Running it locally.

    python scripts/serveOnNetwork.py [port]        (serveOnNetwork.bat runs this)
"""

import errno
import functools
import http.server
import os
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REAL_ROOT = Path(os.path.realpath(ROOT))
DEFAULT_PORT = 8000


# Asked of the file a request would really open, rather than of the URL text.
# Windows answers to a folder's short name as well, and GIT~1 has no dot to
# match; a request line can also spell a folder so that it parses as the host
# and never reaches the path. Both land on the same file, and realpath names it.
def hidden(path):
    try:
        inside = Path(os.path.realpath(path)).relative_to(REAL_ROOT)
    except (OSError, ValueError):
        return True
    return any(part.startswith(".") for part in inside.parts)


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # The whole network can reach this, so .git and the other dot entries
        # stay off it.
        if hidden(self.translate_path(self.path)):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        # A phone browser caches hard, and a stale script after an edit looks
        # exactly like a bug in the change being tested.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # On Windows, reusing the address lets a second server bind a port that is
    # already taken, and requests then land on either one.
    allow_reuse_address = sys.platform != "win32"


class DualStackServer(Server):
    # Windows tries localhost over IPv6 first, and against an IPv4-only server
    # every request waits for that to fail, which makes a page load crawl. One
    # socket taking both answers ::1 straight away and still reaches the network
    # over IPv4.
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def make_server(port, handler):
    if socket.has_ipv6:
        try:
            return DualStackServer(("::", port), handler)
        except OSError as error:
            # A taken port is the same answer on IPv4, so say so rather than
            # quietly binding half of it.
            if error.errno in (errno.EADDRINUSE, errno.EACCES):
                raise
    return Server(("0.0.0.0", port), handler)


def network_address():
    # Connecting a UDP socket sends nothing. It only asks the OS which interface
    # traffic would leave through, and that is the address the external device can reach.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.0.2.1", 80))
            return probe.getsockname()[0]
        except OSError:
            return None


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            port = None
        # 0 would bind whatever port is free and then print 0 as the address.
        if port is None or not 1 <= port <= 65535:
            print(f'"{sys.argv[1]}" is not a port: use a number from 1 to 65535. '
                  "Usage: python scripts/serveOnNetwork.py [port]")
            return 1

    try:
        server = make_server(port, functools.partial(Handler, directory=str(ROOT)))
    except OSError as error:
        print(f"Could not start on port {port}: {error.strerror or error}")
        print("Something else may be using it. Pass another port: "
              "python scripts/serveOnNetwork.py 8080")
        return 1

    address = network_address()
    print(f"On this computer:        http://localhost:{port}")
    if address:
        print(f"On your external device: http://{address}:{port}")
    else:
        print("Could not find this computer's network address. Look it up in your "
              f"network settings and open http://<address>:{port} on your external device.")
    print()
    print("The external device has to be on the same Wi-Fi. If it can't connect, the firewall "
          "is blocking Python: allow it on private networks.")
    print("Press Ctrl+C to stop.")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
