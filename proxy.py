from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import urllib.request
import json

# ==============================
# CONFIG
# ==============================
GINGR_APP = "pawspet"          # e.g. pawspet
GINGR_API_KEY = "9592bc4615d1c42b4e7cfbf04b16cf35"

GINGR_URL = f"https://{GINGR_APP}.gingrapp.com/api/v1/reservation_widget_data"


class RequestHandler(BaseHTTPRequestHandler):

    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        # ------------------------------
        # Health check
        # ------------------------------
        if parsed.path == "/":
            self._set_headers(200)
            self.wfile.write(json.dumps({
                "status": "ok",
                "service": "gingr-reservation-proxy"
            }).encode())
            return

        # ------------------------------
        # Reservations endpoint
        # ------------------------------
        if parsed.path != "/reservations":
            self._set_headers(404)
            self.wfile.write(json.dumps({
                "error": "Not Found"
            }).encode())
            return

        params = parse_qs(parsed.query)
        date = params.get("date", [None])[0]

        if not date:
            self._set_headers(400)
            self.wfile.write(json.dumps({
                "error": "Missing required parameter: date (YYYY-MM-DD)"
            }).encode())
            return

        query = f"?key={GINGR_API_KEY}&timestamp={date}"

        try:
            with urllib.request.urlopen(GINGR_URL + query, timeout=10) as resp:
                gingr_data = json.loads(resp.read().decode())
        except Exception as e:
            self._set_headers(500)
            self.wfile.write(json.dumps({
                "error": "Failed to reach Gingr API",
                "details": str(e)
            }).encode())
            return

        self._set_headers(200)
        self.wfile.write(json.dumps({
            "date": date,
            "gingr_response": gingr_data
        }).encode())


# ==============================
# SERVER
# ==============================
if __name__ == "__main__":
    PORT = 5050
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"Server running on http://localhost:{PORT}")
    server.serve_forever()
