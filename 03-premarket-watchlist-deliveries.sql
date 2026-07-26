CREATE TABLE IF NOT EXISTS premarket_watchlist_deliveries (
  session_date DATE PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  telegram_message_ids BIGINT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE premarket_watchlist_deliveries
  ADD COLUMN IF NOT EXISTS telegram_message_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS report_json JSONB,
  ADD COLUMN IF NOT EXISTS formatted_message TEXT,
  ADD COLUMN IF NOT EXISTS report_hash TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

UPDATE premarket_watchlist_deliveries
SET updated_at = COALESCE(updated_at, created_at, now());

ALTER TABLE premarket_watchlist_deliveries
  DROP CONSTRAINT IF EXISTS premarket_watchlist_deliveries_status_check;

ALTER TABLE premarket_watchlist_deliveries
  ADD CONSTRAINT premarket_watchlist_deliveries_status_check CHECK (
    status IN (
      'PROCESSING',
      'DELIVERY_STARTED',
      'SENT',
      'PARTIAL_DELIVERY',
      'DELIVERY_UNCONFIRMED',
      'FAILED'
    )
  );

ALTER TABLE premarket_watchlist_deliveries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE premarket_watchlist_deliveries IS
  'Idempotency and audit ledger for the automated Fahd premarket Telegram watchlist.';
