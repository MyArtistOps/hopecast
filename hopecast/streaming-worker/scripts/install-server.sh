#!/usr/bin/env bash
# HopeCast streaming worker — fresh Ubuntu 22.04/24.04 VPS install script.
# Run as a non-root sudo user: bash install-server.sh
set -euo pipefail

echo "== Updating system =="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "== Installing FFmpeg =="
sudo apt-get install -y ffmpeg
ffmpeg -version

echo "== Installing Node.js 20 LTS =="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v

echo "== Installing PM2 =="
sudo npm install -g pm2

echo "== Creating directories =="
sudo mkdir -p /var/hopecast/media-cache
sudo mkdir -p /var/log/hopecast
sudo chown -R "$USER":"$USER" /var/hopecast /var/log/hopecast

echo "== Installing worker dependencies =="
cd "$(dirname "$0")/.."
npm install --omit=dev

echo "== Next steps =="
cat <<'EOF'
1. Copy .env.example to .env and fill in real values (never commit .env).
2. Start with PM2:
     pm2 start ecosystem.config.js
     pm2 save
3. Enable PM2 on boot:
     pm2 startup systemd
   (run the printed command it gives you, then `pm2 save` again)
4. Confirm health:
     curl http://localhost:4000/health
EOF
