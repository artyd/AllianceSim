# The bot talks only to the api; the api queues notifications

The Telegram bot has no database access. It reads and writes through the same token-gated HTTP endpoints as the site (`bot/src/api.js`), and outbound Telegram messages are rows the api queues (`notifications`) and the bot drains every few seconds. Validation and data shape live in one place, and the api never needs the Telegram network.

## Consequences

- A feature that messages people adds a notification `kind` in the api and its text/buttons in the bot's drain.
- Long-running deliveries mark the notification sent first, so the next drain tick does not repeat it.
