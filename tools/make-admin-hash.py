#!/usr/bin/env python3
"""Make the PREVIEW-mode admin password hash for site/js/config.js (DEMO_ADMIN).
The password is typed hidden and is never printed or saved; only salt + PBKDF2-SHA256 hash are printed."""
import base64, getpass, hashlib, json, os
email = input("Admin email [ravitechsolution.shop@gmail.com]: ").strip().lower() or "ravitechsolution.shop@gmail.com"
pw = getpass.getpass("New preview admin password (hidden): ")
if len(pw) < 10 or getpass.getpass("Repeat it: ") != pw:
    raise SystemExit("Passwords must match and be at least 10 characters.")
salt, iters = os.urandom(16), 600000
dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iters, 32)
print(json.dumps({"email": email, "alg": "PBKDF2-SHA256", "iterations": iters,
                  "salt_b64": base64.b64encode(salt).decode(), "hash_b64": base64.b64encode(dk).decode()}, indent=2))
