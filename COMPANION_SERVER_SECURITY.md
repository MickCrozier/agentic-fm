# Companion Server Security Configuration

## Overview

The companion server now restricts access to localhost and Docker containers only by default. All requests from unauthorized IP addresses are rejected with a **403 Forbidden** response.

## Default Configuration

**Bind address:** `0.0.0.0` (listens on all interfaces)  
**Allowed IPs/Networks:**
- `127.0.0.1` — localhost
- `172.17.0.0/16` — Docker default bridge network
- `172.18.0.0/16` — Docker custom network 1
- `172.19.0.0/16` — Docker custom network 2
- `172.20.0.0/16` — Docker custom network 3
- `192.168.0.0/16` — Docker host network / local network range

## Starting the Server

```bash
# Default: binds to 0.0.0.0 on port 8765 with IP filtering
python3 agent/scripts/companion_server.py

# Custom port
python3 agent/scripts/companion_server.py --port 9000
```

## Customizing Allowed IPs

Override the default allowlist using the `COMPANION_ALLOWED_IPS` environment variable (comma-separated, supports CIDR notation):

```bash
# Allow only localhost and a specific Docker network
export COMPANION_ALLOWED_IPS="127.0.0.1,192.168.1.0/24"
python3 agent/scripts/companion_server.py

# Allow localhost, a custom Docker bridge, and your office network
export COMPANION_ALLOWED_IPS="127.0.0.1,172.20.0.0/16,203.0.113.0/24"
python3 agent/scripts/companion_server.py
```

## Docker Containers → Host Access

For Docker containers to reach the companion server on the host machine:

**Option 1: Docker default bridge** — Use `host.docker.internal` (Docker Desktop)
```bash
curl http://host.docker.internal:8765/health
```

**Option 2: Custom Docker network** — Use the host's IP on the custom network
```bash
# Create a custom network if needed
docker network create custom-net --subnet=172.20.0.0/16

# Run container and connect to the network
docker run --network=custom-net myimage
# Inside container, curl the host IP from that network
```

**Option 3: Host network mode** — Container shares the host's network stack
```bash
docker run --network=host myimage
# Inside container, curl localhost
curl http://localhost:8765/health
```

## Security

- **All requests from unauthorized IPs are logged** with `[WARNING]` severity and rejected with HTTP 403
- The allowed IP list is checked on **every request** (both GET and POST)
- The server **does not authenticate** — IP-based access control is sufficient for local development
- For production use, add additional authentication (API keys, OAuth, etc.)

## Reverting to localhost-only

To bind only to localhost (no Docker containers):

```bash
export COMPANION_BIND_HOST="127.0.0.1"
python3 agent/scripts/companion_server.py
```

This also ignores the IP allowlist, as localhost always has access.

## Troubleshooting

**"Connection refused" from Docker container?**
- Verify the container can reach the host network (try `ping host.docker.internal` or the host IP)
- Check that the companion server is running: `curl http://localhost:8765/health`
- Verify the container's IP is in the `COMPANION_ALLOWED_IPS` list: Check server logs for rejected IPs

**"Forbidden (403)" error?**
- Your container's IP is not in the allowed list
- Check the server logs for the rejected IP address
- Add that IP or network range to `COMPANION_ALLOWED_IPS`

**Server log shows rejected requests?**
```
WARNING Rejected request from unauthorized IP: 203.0.113.45
```
This means the request came from an IP not in the allowlist. Either:
1. Allow that IP: `export COMPANION_ALLOWED_IPS="...,203.0.113.45"`
2. Or add its network range: `export COMPANION_ALLOWED_IPS="...,203.0.113.0/24"`
