#!/bin/bash
cd "$(dirname "$0")"

# Start ngrok in background
echo "Starting ngrok..."
ngrok http 3000 --log=stdout > /tmp/ngrok-pocha.log 2>&1 &
NGROK_PID=$!

# Cleanup: kill ngrok when script exits
cleanup() {
  kill $NGROK_PID 2>/dev/null
}
trap cleanup EXIT

# Wait for ngrok API to be ready and get public URL
echo "Waiting for ngrok tunnel..."
for i in {1..30}; do
  sleep 1
  URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for t in data.get('tunnels', []):
        if t.get('proto') == 'https':
            print(t['public_url'])
            break
except: pass
" 2>/dev/null)
  if [ -n "$URL" ]; then
    echo "ngrok URL: $URL"
    break
  fi
done

if [ -z "$URL" ]; then
  echo "Failed to get ngrok URL. Is ngrok installed and authenticated?"
  kill $NGROK_PID 2>/dev/null
  exit 1
fi

# Build and start server (server will auto-discover ngrok URL from 127.0.0.1:4040)
npm run build && cd server && npm start
