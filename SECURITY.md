# Security

Do not include passwords, tokens, private URLs, voice recordings, practice exports,
or unredacted logs in public issues. Use a repository owner's private security
reporting channel if available. Do not post a vulnerability with private data in
a public issue to obtain a contact address.

The public server only serves app assets and `/api/health`; no recording storage
or administration API is shipped. Host over HTTPS and keep Node and dependencies
updated. Do not expose the development server on an untrusted network.

Before publishing, scan the exact export and its Git history with Gitleaks:

```sh
gitleaks dir --redact=100 .
gitleaks git --redact=100 --log-opts="--all" .
```

These checks are useful safeguards, not a guarantee that every kind of private
information is detectable. If a real credential was previously published,
revoke it; removing it from the latest file is insufficient.
