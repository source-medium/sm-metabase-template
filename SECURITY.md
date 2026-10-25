# Security

## Reporting a vulnerability

Report security issues privately through GitHub: on this repository's
**Security** tab, choose **Report a vulnerability**. Please do not open a
public issue.

If your report involves a live credential, do not include it. If you believe a
warehouse key file was exposed, an editor or admin revokes it in **Dashboards &
Apps** in your SourceMedium workspace (**Manage → Revoke access**) and creates a
new one; replacing the key alone does not cut off tokens already issued. Then
contact SourceMedium.

## Scope and design limits

The installer runs on your computer with your own Metabase API key. It reads
Metabase metadata, writes only inside its own collection and SQL snippets, and
never sends data or credentials to SourceMedium. Metabase filters are
navigation: anyone who can write SQL on the connection can read everything the
warehouse key reaches. These are design limits, not vulnerabilities. Changes you
make to your copy are outside SourceMedium's support.

## Supported versions

Security fixes go to `main`. Your copy is your code: to take a fix, merge `main`
into your copy and plan again.
