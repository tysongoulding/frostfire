#!/usr/bin/env bash
set -euo pipefail

echo "=== Frostfire 3-User MicroVM Cluster Setup ==="

# 1. Install prerequisites
sudo apt-get update && sudo apt-get install -y --no-install-recommends     docker.io websockify novnc python3 python3-pip iptables curl ca-certificates

sudo systemctl enable --now docker

# 2. Build MicroVM Rootfs Image
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "${SCRIPT_DIR}")"
BUILD_DIR="/tmp/frostfire-build"
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}/guest-scripts" "${BUILD_DIR}/openbox" "${BUILD_DIR}/assets"

if [ -f "${REPO_DIR}/deploy/assets/frostfire-wallpaper.jpg" ]; then
    cp "${REPO_DIR}/deploy/assets/frostfire-wallpaper.jpg" "${BUILD_DIR}/assets/frostfire.jpg"
fi

cat << 'EOF' > "${BUILD_DIR}/guest-scripts/chrome-launcher"
#!/usr/bin/env bash
set -e
TARGET_URL="${1:-https://google.com}"
DISP_NUM="${DISPLAY#*:}"
DISP_NUM="${DISP_NUM%%.*}"
DISP_NUM="${DISP_NUM:-1}"
DATA_DIR="/home/ubuntu/.config/google-chrome-disp-${DISP_NUM}"
mkdir -p "${DATA_DIR}"

(
  for _ in {1..30}; do
    if wmctrl -r "Google Chrome" -b add,maximized_vert,maximized_horz 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
) &

exec /usr/bin/google-chrome   --no-sandbox   --test-type   --disable-infobars   --disable-dev-shm-usage   --disable-gpu   --no-first-run   --no-default-browser-check   --disable-notifications   --disable-popup-blocking   --password-store=basic   --start-maximized   --window-position=0,0   --window-size=1280,800   --user-data-dir="${DATA_DIR}"   "${TARGET_URL}"
EOF

cat << 'EOF' > "${BUILD_DIR}/guest-scripts/terminal-launcher"
#!/usr/bin/env bash
set -e
(
  for _ in {1..30}; do
    if wmctrl -r "Terminal" -b add,maximized_vert,maximized_horz 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
) &
exec /usr/bin/xfce4-terminal --maximize --zoom=1 --geometry=1280x800+0+0
EOF

cat << 'EOF' > "${BUILD_DIR}/guest-scripts/files-launcher"
#!/usr/bin/env bash
set -e
mkdir -p /home/ubuntu
(
  for _ in {1..30}; do
    if wmctrl -r "thunar" -b add,maximized_vert,maximized_horz 2>/dev/null || wmctrl -r "File Manager" -b add,maximized_vert,maximized_horz 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
) &
exec dbus-run-session /usr/bin/thunar /home/ubuntu
EOF

cat << 'EOF' > "${BUILD_DIR}/guest-scripts/exec-server.py"
import http.server, socketserver, json, subprocess, os

PORT = 3000

class ExecHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/exec':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode('utf-8'))
                display = data.get('display', 1)
                cmd = data.get('command', '')
                cwd = data.get('cwd', '/home/ubuntu')
                background = data.get('background', False)

                env = os.environ.copy()
                env['DISPLAY'] = f':{display}'
                env['HOME'] = '/home/ubuntu'
                env['USER'] = 'ubuntu'

                if background:
                    p = subprocess.Popen(cmd, shell=True, env=env, cwd=cwd,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         start_new_session=True)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'status': 'started', 'pid': p.pid}).encode())
                else:
                    res = subprocess.run(cmd, shell=True, env=env, cwd=cwd,
                                         capture_output=True, text=True, timeout=30)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'stdout': res.stdout,
                        'stderr': res.stderr,
                        'exitCode': res.returncode
                    }).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

if __name__ == '__main__':
    with ThreadingHTTPServer(('0.0.0.0', PORT), ExecHandler) as httpd:
        httpd.serve_forever()
EOF

cat << 'EOF' > "${BUILD_DIR}/guest-scripts/microvm-entrypoint.sh"
#!/usr/bin/env bash
set -e
export HOME=/home/ubuntu
export USER=ubuntu

mkdir -p /tmp/.X11-unix /tmp/logs /home/ubuntu/.config/openbox
chmod 1777 /tmp/.X11-unix /tmp
cp -f /etc/xdg/openbox/rc.xml /home/ubuntu/.config/openbox/rc.xml 2>/dev/null || true
chown -R ubuntu:ubuntu /home/ubuntu 2>/dev/null || true

for D in 1 2 3; do
  RFB=$((5900 + D))
  Xvfb ":${D}" -screen 0 1280x800x24 -ac +extension GLX +render -noreset > "/tmp/logs/xvfb_${D}.log" 2>&1 &
  for _ in {1..30}; do
    [ -S "/tmp/.X11-unix/X${D}" ] && break
    sleep 0.1
  done
  DISPLAY=":${D}" feh --no-fehbg --bg-fill /usr/share/backgrounds/frostfire.jpg > /dev/null 2>&1 &
  DISPLAY=":${D}" openbox-session > "/tmp/logs/openbox_${D}.log" 2>&1 &
  x11vnc -skip_lockkeys -display ":${D}" -nopw -shared -forever -noxdamage -rfbport "${RFB}" > "/tmp/logs/x11vnc_${D}.log" 2>&1 &
done

python3 /usr/local/bin/exec-server.py > /tmp/logs/exec-server.log 2>&1 &
exec sleep infinity
EOF

chmod +x ${BUILD_DIR}/guest-scripts/*

cat << 'EOF' > "${BUILD_DIR}/openbox/rc.xml"
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme>
    <name>Clearlooks</name>
    <titleLayout>NLIMC</titleLayout>
  </theme>
  <applications>
    <application class="*">
      <maximized>yes</maximized>
      <decor>yes</decor>
    </application>
  </applications>
</openbox_config>
EOF

cat << 'EOF' > "${BUILD_DIR}/Dockerfile"
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends     ca-certificates curl wget git sudo procps net-tools iproute2 iptables     xvfb x11vnc openbox xfce4-terminal thunar dbus-x11 python3     wmctrl feh && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb     && apt-get update && apt-get install -y /tmp/chrome.deb && rm -f /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*
RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash -u 1000 ubuntu &&     echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/ubuntu && chmod 0440 /etc/sudoers.d/ubuntu
RUN mkdir -p /usr/share/backgrounds
COPY assets/frostfire.jpg /usr/share/backgrounds/frostfire.jpg
COPY openbox/rc.xml /etc/xdg/openbox/rc.xml
COPY guest-scripts/* /usr/local/bin/
RUN chmod +x /usr/local/bin/*
ENTRYPOINT ["/usr/local/bin/microvm-entrypoint.sh"]
EOF

echo "Building frostfire-microvm-rootfs image..."
docker build -t frostfire-microvm-rootfs:latest "${BUILD_DIR}"

# 3. Create Networks & Run 3 MicroVMs
for i in 1 2 3; do
    NET="net-user${i}"
    IP="172.16.$((i-1)).2"
    NAME="frostfire-microvm-user${i}"
    docker network inspect "${NET}" >/dev/null 2>&1 ||         docker network create --driver bridge --subnet="172.16.$((i-1)).0/24" --gateway="172.16.$((i-1)).1" "${NET}"
    docker rm -f "${NAME}" 2>/dev/null || true
    docker run -d         --name "${NAME}"         --restart always         --net "${NET}"         --ip "${IP}"         --hostname "frostfire-user${i}-vm"         --privileged         --ipc=host         --shm-size=2g         -v "user${i}-home:/home/ubuntu"         frostfire-microvm-rootfs:latest
done

# 4. Host Gateway Service
GATEWAY_DIR="/opt/frostfire/gateway"
sudo mkdir -p "${GATEWAY_DIR}" /var/log/frostfire

cat << 'EOF' > "${GATEWAY_DIR}/gateway.py"
import http.server, socketserver, json, urllib.request, subprocess, sys, os, signal

PORT_MAP = [
    (6080, '172.16.0.2', 5901), (6081, '172.16.0.2', 5902), (6082, '172.16.0.2', 5903),
    (6083, '172.16.1.2', 5901), (6084, '172.16.1.2', 5902), (6085, '172.16.1.2', 5903),
    (6086, '172.16.2.2', 5901), (6087, '172.16.2.2', 5902), (6088, '172.16.2.2', 5903),
]

ws_procs = []
for hp, ip, rfb in PORT_MAP:
    p = subprocess.Popen(['websockify', '--web=/usr/share/novnc', '--heartbeat=30', f'0.0.0.0:{hp}', f'{ip}:{rfb}'],
                         stdout=open(f'/var/log/frostfire/ws_{hp}.log', 'w'), stderr=subprocess.STDOUT)
    ws_procs.append(p)

def cleanup(sig, frame):
    for p in ws_procs: p.terminate()
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

VM_MAP = {'user1': '172.16.0.2', 'user2': '172.16.1.2', 'user3': '172.16.2.2'}

class ExecRouterHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "ok", "service": "frostfire-microvm-gateway"}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/exec':
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length).decode('utf-8'))
            disp = data.get('display', 1)
            uid = data.get('userId')
            tip = VM_MAP[uid] if uid in VM_MAP else ('172.16.0.2' if disp <= 3 else ('172.16.1.2' if disp <= 6 else '172.16.2.2'))
            data['display'] = ((disp - 1) % 3) + 1
            req = urllib.request.Request(f"http://{tip}:3000/exec", data=json.dumps(data).encode('utf-8'),
                                         headers={'Content-Type': 'application/json'}, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=35) as resp:
                    res = resp.read()
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(res)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True

with ThreadingHTTPServer(('0.0.0.0', 3000), ExecRouterHandler) as s:
    s.serve_forever()
EOF

cat << 'EOF' | sudo tee /etc/systemd/system/frostfire-microvm-gateway.service
[Unit]
Description=Frostfire MicroVM Gateway
After=network.target docker.service

[Service]
Type=simple
User=root
ExecStart=/usr/bin/python3 /opt/frostfire/gateway/gateway.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now frostfire-microvm-gateway.service

echo "[✓] Frostfire 3-User MicroVM Cluster successfully deployed!"
