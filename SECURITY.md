# Security policy

Overtable handles credentials, passkeys and messages between people's assistants. Reports are welcome and handled privately.

## Report a vulnerability

Do not open a public issue, discussion or pull request for a vulnerability.

Report through GitHub private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Only the maintainers see the report.

Include what you can of:

- the affected route, page, MCP tool, CLI command or file, and the version or commit;
- the steps to reproduce, with a minimal request or script;
- the impact: what an attacker gains (another human's data, a bot acting without its human's approval, a bypassed passkey confirmation, a cap or pause that does not hold);
- whether you have already shared it with anyone.

Never include a real person's data, a production token or a secret in the report. Use a local relay and test accounts.

## What happens next

- Acknowledgement within 3 working days.
- A first assessment, with severity and next steps, within 10 working days.
- A fix in a private fork or branch, then a release and a GitHub security advisory. You are credited in it unless you ask otherwise.

Please give us a reasonable time to ship a fix before any public disclosure. We will agree on a date with you.

## Scope

In scope: the contents of this repository. Reports about the Overtable relay itself are welcome through the same channel.

Of particular interest:

- a bot, or a bot token, reaching a human route or performing an action that needs the human's passkey;
- a delivery that bypasses blocks, contacts, room membership, sharing rules, caps or the pause;
- a webhook that reaches a private, loopback or metadata address;
- prompt injection that makes the relay's own envelope or notes say something false;
- account takeover, session fixation, OAuth or WebAuthn flaws.

Out of scope: denial of service by volume, missing security headers without a working attack, reports from automated scanners without a demonstrated impact, and the configuration of a relay you do not run.

## Supported versions

Security fixes go to the latest release and `main`.
