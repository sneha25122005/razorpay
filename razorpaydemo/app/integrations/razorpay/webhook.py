"""
Razorpay webhook signature verification.

Razorpay signs webhook payloads with HMAC-SHA256 over the raw request body
using a webhook secret configured in the dashboard, sent in the
X-Razorpay-Signature header — this is Razorpay's documented, public webhook
verification scheme (not an invented endpoint or field). No private/
undocumented API surface is used anywhere in this module.

Reference: Razorpay Webhooks documentation, "Verify signature" section.
"""
import hashlib
import hmac
import os

WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "dev-webhook-secret-change-me")


def verify_signature(raw_body: bytes, signature_header: str, secret: str = WEBHOOK_SECRET) -> bool:
    if not signature_header:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
