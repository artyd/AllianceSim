# Identity: the HR code on the web, Telegram on the phone

There are no accounts or passwords. The web's builder mode and HR endpoints accept the shared HR code (`EDIT_TOKEN`). Everything personal is reached from the Telegram Mini App: the api verifies the signed `initData` (or a short session token minted from it) and resolves the caller to their linked employee. HR inside Telegram is decided by `HR_NAMES` / `HR_TG_IDS` on the server.

## Considered options

User accounts with logins were rejected: the whole office already uses Telegram, and HR wanted zero onboarding.
