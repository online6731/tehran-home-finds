# Hourly Telegram catalog sync

The existing catalog workflow fetches Divar every hour at minute 19 UTC.
`tehran-home-sync.timer` reads the published catalog at minute 55 UTC, after
the normal source collection window. GitHub scheduling and source rate limits
can delay publication; incomplete coverage is retained in `summary.json`.

The synchronizer uses the existing AIRA bot and forum category IDs. It edits
tracked messages, sends only new IDs, preserves the complete photo slideshow,
and caches Telegram photo file IDs for later edits. Absolute Divar timestamps
are embedded as native relative `tg-time` elements, so supported Telegram
clients advance the displayed age while viewing the message. Client language
controls the relative time label.

Price, location, time and estimated condition are visible in a compact card.
Seller text, observations, confidence, distance references and limitations are
collapsed. Unreviewed photos are explicitly labeled. An expired or absent ad
is marked outside the current catalog; this does not assert that it sold.

## Deployment

Requires Python 3.11+, requests and Pillow in the configured runtime. Install
`sync.py` in `/opt/tehran-home-sync/`, and the service/timer in
`/etc/systemd/system/`. The root-only state directory is
`/var/lib/tehran-home-sync/`. It contains `topics.json`, `emoji-catalog.json`,
`state.json`, image cache and receipts; never commit them. The token is read
only from the existing `/etc/aira/secrets/AIRA_BOT_TOKEN` file.

For a new installation, state defaults to empty. For an existing deployment,
seed `items[id]` with its confirmed `message_id`, `thread` and complete `ad`
to migrate by editing instead of reposting. The lock prevents overlap.
Before a new send, a durable `sending` marker is written. Ambiguous sends are
held for reconciliation; they are not retried automatically. Edits are safe
to reapply after a transport failure. 429 responses use Telegram retry delays.

```sh
systemctl daemon-reload
systemctl enable --now tehran-home-sync.timer
systemctl start --no-block tehran-home-sync.service
systemctl list-timers tehran-home-sync.timer
journalctl -u tehran-home-sync.service -n 10
```

Review `/var/lib/tehran-home-sync/summary.json` for run completion, errors,
counts and upstream freshness. `--only ID` performs a sample edit; sample
results are stored separately and do not overwrite the full-run summary.

The compact migration was verified on an existing four-photo message before
the full run. Credential values must never be logged or included in commands.
