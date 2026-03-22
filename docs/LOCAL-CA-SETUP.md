# Local Certificate Authority & TLS Setup

This guide walks through creating a private Certificate Authority (CA), issuing a server certificate for the Raspberry Pi, installing it in nginx, and trusting the CA on your client devices so you get clean HTTPS with no browser warnings.

---

## Prerequisites

- `openssl` installed on the Pi (should already be there)
- nginx installed and running on the Pi
- Know your Pi's local IP address (e.g. `192.168.1.33`)
- Optionally, a local hostname for the Pi (e.g. `homepi.local`)

---

## Step 1: Create the Certificate Authority

This creates a private CA that you'll trust on your client devices. The CA key is the crown jewel -- keep it safe.

```bash
# Create a directory structure for the CA
mkdir -p ~/ha-mcp-ca/{ca,server}
cd ~/ha-mcp-ca

# Generate the CA private key (4096-bit RSA)
openssl genrsa -aes256 -out ca/ca.key 4096

# You'll be prompted for a passphrase. Pick something strong and store it
# somewhere safe (password manager). You'll need it when signing certificates.

# Generate the CA root certificate (valid for 10 years)
openssl req -x509 -new -nodes \
  -key ca/ca.key \
  -sha256 \
  -days 3650 \
  -out ca/ca.crt \
  -subj "/C=GB/ST=Local/L=Home/O=Home Lab/CN=Home Lab CA"
```

You now have two files:
- `ca/ca.key` -- the CA private key (keep this secret and backed up)
- `ca/ca.crt` -- the CA root certificate (this is what you distribute to client devices)

---

## Step 2: Generate the Server Certificate

This creates a certificate for your Pi that's signed by your CA.

```bash
cd ~/ha-mcp-ca

# Generate the server private key (no passphrase -- nginx needs to read it on startup)
openssl genrsa -out server/server.key 2048

# Create a certificate signing request (CSR) configuration
cat > server/server.csr.cnf << 'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C = GB
ST = Local
L = Home
O = Home Lab
CN = homepi.local

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = homepi.local
DNS.2 = homepi
IP.1 = 192.168.1.33
IP.2 = 127.0.0.1
EOF
```

**Important:** Edit `server.csr.cnf` and replace `192.168.1.33` with your Pi's actual IP address. Add any other hostnames or IPs you might use to reach it under `[alt_names]`.

```bash
# Generate the CSR
openssl req -new \
  -key server/server.key \
  -out server/server.csr \
  -config server/server.csr.cnf

# Create the extensions file for signing
cat > server/server.ext << 'EOF'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = homepi.local
DNS.2 = homepi
IP.1 = 192.168.1.33
IP.2 = 127.0.0.1
EOF
```

**Again:** Edit `server.ext` to match the same IPs/hostnames.

```bash
# Sign the server certificate with the CA (valid for 2 years)
openssl x509 -req \
  -in server/server.csr \
  -CA ca/ca.crt \
  -CAkey ca/ca.key \
  -CAcreateserial \
  -out server/server.crt \
  -days 730 \
  -sha256 \
  -extfile server/server.ext

# Verify the certificate
openssl x509 -in server/server.crt -text -noout | grep -A1 "Subject Alternative Name"
```

You should see your IP and hostname(s) listed under Subject Alternative Name.

---

## Step 3: Install the Certificate in nginx

```bash
# Copy certs to nginx directory
sudo mkdir -p /etc/nginx/ssl/ha-mcp
sudo cp server/server.crt /etc/nginx/ssl/ha-mcp/
sudo cp server/server.key /etc/nginx/ssl/ha-mcp/

# Lock down permissions on the private key
sudo chown root:root /etc/nginx/ssl/ha-mcp/server.key
sudo chmod 600 /etc/nginx/ssl/ha-mcp/server.key
```

---

## Step 4: Configure nginx

Create the site configuration for the MCP server:

```bash
sudo nano /etc/nginx/sites-available/ha-mcp
```

```nginx
# Redirect HTTP to HTTPS (optional but good practice)
server {
    listen 80;
    listen [::]:80;
    server_name homepi.local 192.168.1.33;

    # Only redirect MCP paths -- leave other services alone
    location /mcp {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server for MCP
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name homepi.local 192.168.1.33;

    # TLS Configuration
    ssl_certificate     /etc/nginx/ssl/ha-mcp/server.crt;
    ssl_certificate_key /etc/nginx/ssl/ha-mcp/server.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    # MCP Server reverse proxy
    location /mcp {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for SSE (Server-Sent Events)
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        # Pass through client headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;

        # Timeouts -- generous for long-running tool calls
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # Max request body size (for large service call payloads)
        client_max_body_size 1m;
    }

    # Health check endpoint (no auth required)
    location /mcp/health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
    }

    # Block everything else on this server block
    location / {
        return 404;
    }

    # Access logging for audit trail
    access_log /var/log/nginx/ha-mcp-access.log;
    error_log  /var/log/nginx/ha-mcp-error.log;
}
```

**Note:** If nginx is already serving Home Assistant or other services on port 443, you'll need to merge this into your existing server block or use a different port (e.g. `8443`). If HA is using a separate `server_name`, the above should coexist fine as nginx routes by `server_name`.

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/ha-mcp /etc/nginx/sites-enabled/

# Test the configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

---

## Step 5: Trust the CA on Client Devices

You need to copy `ca/ca.crt` from the Pi to each device that will connect to the MCP server.

```bash
# Easy way to get the file off the Pi
cat ~/ha-mcp-ca/ca/ca.crt
# Copy the output, or use scp:
# scp pi@192.168.1.33:~/ha-mcp-ca/ca/ca.crt ~/Desktop/home-lab-ca.crt
```

### macOS

```bash
# Import into the system keychain
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain home-lab-ca.crt
```

Or via the GUI:
1. Open Keychain Access
2. Drag `home-lab-ca.crt` into the "System" keychain
3. Double-click the imported "Home Lab CA" certificate
4. Expand "Trust" and set "When using this certificate" to "Always Trust"
5. Close and authenticate

### Windows

1. Double-click `home-lab-ca.crt`
2. Click "Install Certificate"
3. Select "Local Machine" (requires admin)
4. Choose "Place all certificates in the following store"
5. Click "Browse" and select "Trusted Root Certification Authorities"
6. Click "Next" then "Finish"

Or via PowerShell (as admin):
```powershell
Import-Certificate -FilePath "home-lab-ca.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

### Linux (Debian/Ubuntu)

```bash
sudo cp home-lab-ca.crt /usr/local/share/ca-certificates/home-lab-ca.crt
sudo update-ca-certificates
```

### iOS

1. AirDrop or email the `ca.crt` file to your device
2. Open it -- you'll see "Profile Downloaded"
3. Go to Settings > General > VPN & Device Management
4. Tap the "Home Lab CA" profile and install it
5. Go to Settings > General > About > Certificate Trust Settings
6. Enable full trust for "Home Lab CA"

### Android

1. Transfer `ca.crt` to the device
2. Go to Settings > Security > Encryption & Credentials > Install a certificate
3. Select "CA certificate"
4. Choose the file and confirm

---

## Step 6: Verify Everything Works

```bash
# From a client machine where you've trusted the CA:
curl -v https://192.168.1.33/mcp/health

# You should see:
# * SSL certificate verify ok.
# No warnings, no errors.

# If you haven't started the MCP server yet, you'll get a 502 from nginx
# which is expected -- it means TLS is working but there's no upstream.
```

---

## Certificate Renewal

The server certificate expires after 2 years. To renew:

```bash
cd ~/ha-mcp-ca

# Generate a new CSR (reuse the existing key and config)
openssl req -new \
  -key server/server.key \
  -out server/server.csr \
  -config server/server.csr.cnf

# Sign it again
openssl x509 -req \
  -in server/server.csr \
  -CA ca/ca.crt \
  -CAkey ca/ca.key \
  -CAcreateserial \
  -out server/server.crt \
  -days 730 \
  -sha256 \
  -extfile server/server.ext

# Install and reload
sudo cp server/server.crt /etc/nginx/ssl/ha-mcp/
sudo systemctl reload nginx
```

No need to re-trust on client devices -- the CA hasn't changed, only the server cert.

---

## Security Notes

- **Protect the CA key.** Anyone with `ca.key` and the passphrase can issue certificates that your devices will trust. Store it securely and consider keeping a backup offline.
- **Don't commit certificates to git.** Add `ca/`, `server/`, `certs/`, `*.key`, `*.crt`, `*.csr` to `.gitignore`.
- **The CA cert (`ca.crt`) is safe to distribute** -- it's a public certificate. Only the key is sensitive.
- **Restrict nginx access by subnet** if you want belt-and-braces. Add `allow 192.168.1.0/24; deny all;` inside the `location /mcp` block.
