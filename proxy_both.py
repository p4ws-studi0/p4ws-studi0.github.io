from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs, urlencode
import urllib.request
import json
from datetime import date

# ==============================
# CONFIG
# ==============================
SUBDOMAIN = "pawspet"
API_KEY = "9592bc4615d1c42b4e7cfbf04b16cf35"  # ← PUT YOUR GINGR API KEY HERE
PORT = 8000

ROOMS_URL = f"https://{SUBDOMAIN}.gingrapp.com/api/v1/back_of_house"
WIDGET_URL = f"https://{SUBDOMAIN}.gingrapp.com/api/v1/reservation_widget_data"


class Handler(BaseHTTPRequestHandler):

    def send_json(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_GET(self):
        parsed = urlparse(self.path)

        # --------------------------
        # Health check
        # --------------------------
        if parsed.path == "/":
            self.send_json(200, {
                "status": "ok",
                "service": "gingr-proxy",
                "port": PORT
            })
            return

        # --------------------------
        # Dashboard widget totals
        # /reservations?date=YYYY-MM-DD
        # --------------------------
        if parsed.path == "/reservations":
            params = parse_qs(parsed.query)
            req_date = params.get("date", [None])[0]

            if not req_date:
                self.send_json(400, {
                    "error": "Missing date (YYYY-MM-DD)"
                })
                return

            try:
                with urllib.request.urlopen(
                    f"{WIDGET_URL}?key={API_KEY}&timestamp={req_date}",
                    timeout=10
                ) as resp:
                    data = json.loads(resp.read().decode())
            except Exception as e:
                self.send_json(500, {
                    "error": "Widget API failed",
                    "details": str(e)
                })
                return

            self.send_json(200, {
                "date": req_date,
                "gingr_response": data
            })
            return

        # --------------------------
        # Checked-in rooms
        # /api/rooms
        # --------------------------
        if parsed.path == "/api/rooms":
            today = date.today().isoformat()

            body = urlencode({
                "start_date": today,
                "end_date": today,
                "checked_in": "true",
                "key": API_KEY
            }).encode("utf-8")

            req = urllib.request.Request(
                ROOMS_URL,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            )

            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    raw = resp.read().decode()
                    data = json.loads(raw)
            except Exception as e:
                self.send_json(500, {
                    "error": "Rooms API failed",
                    "details": str(e)
                })
                return

            self.send_json(200, data)
            return

        # --------------------------
        # Fallback
        # --------------------------
        self.send_json(404, {
            "error": "Not Found"
        })


# ==============================
# SERVER
# ==============================
if __name__ == "__main__":
    print(f"🔥 Gingr proxy running on http://localhost:{PORT}")
    print(" • GET /")
    print(" • GET /reservations?date=YYYY-MM-DD")
    print(" • GET /api/rooms")

    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
