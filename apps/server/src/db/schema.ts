/** Append-only list of migrations. Never edit a shipped entry; add a new one. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    near_account TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled BOOLEAN NOT NULL DEFAULT false
  );

  -- Ledger accounts. 'held' = sum of active holds. The CHECK makes it
  -- impossible (at the database level) for available funds to go negative.
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id TEXT,
    pet_id TEXT,
    balance NUMERIC(40,0) NOT NULL DEFAULT 0,
    held NUMERIC(40,0) NOT NULL DEFAULT 0,
    allow_negative BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT held_nonneg CHECK (held >= 0),
    CONSTRAINT available_nonneg CHECK (allow_negative OR balance - held >= 0)
  );

  -- Immutable double-entry journal.
  CREATE TABLE journal (
    id BIGSERIAL PRIMARY KEY,
    idem TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'final',
    config_version TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}',
    settlement_ref TEXT,
    settled_batch BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE postings (
    id BIGSERIAL PRIMARY KEY,
    journal_id BIGINT NOT NULL REFERENCES journal(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    amount NUMERIC(40,0) NOT NULL,
    CONSTRAINT nonzero CHECK (amount <> 0)
  );
  CREATE INDEX postings_account ON postings(account_id, id);
  CREATE INDEX postings_journal ON postings(journal_id);

  CREATE TABLE holds (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    amount NUMERIC(40,0) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE pets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    species TEXT NOT NULL,
    rarity TEXT NOT NULL,
    name TEXT NOT NULL,
    genome JSONB NOT NULL,
    sticker TEXT,
    nft_token_id TEXT UNIQUE,
    mint_status TEXT NOT NULL DEFAULT 'awaiting_chain',
    catch_attempt_id TEXT,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX pets_owner ON pets(owner_id);

  CREATE TABLE equipment (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    pet_id TEXT REFERENCES pets(id),
    kind TEXT NOT NULL,
    rarity TEXT NOT NULL,
    equipped BOOLEAN NOT NULL DEFAULT false,
    nft_token_id TEXT UNIQUE,
    mint_status TEXT NOT NULL DEFAULT 'awaiting_chain',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state JSONB NOT NULL
  );

  CREATE TABLE hq_inventory (
    resource TEXT PRIMARY KEY,
    qty BIGINT NOT NULL DEFAULT 0 CHECK (qty >= 0)
  );

  CREATE TABLE resource_events (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    resource TEXT NOT NULL,
    qty INT NOT NULL,
    ref TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE treasury_days (
    day DATE PRIMARY KEY,
    hq_available_start NUMERIC(40,0) NOT NULL,
    merchant_allowance NUMERIC(40,0) NOT NULL,
    merchant_granted NUMERIC(40,0) NOT NULL DEFAULT 0,
    reward_pool NUMERIC(40,0) NOT NULL,
    reward_paid NUMERIC(40,0) NOT NULL DEFAULT 0,
    factor_bps INT NOT NULL,
    CONSTRAINT merchant_within CHECK (merchant_granted <= merchant_allowance),
    CONSTRAINT reward_within CHECK (reward_paid <= reward_pool)
  );

  CREATE TABLE fairness_epochs (
    id BIGINT PRIMARY KEY,
    commitment TEXT NOT NULL,
    seed TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    revealed BOOLEAN NOT NULL DEFAULT false
  );

  CREATE TABLE catch_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL,
    species TEXT,
    detection JSONB,
    image_hash TEXT,
    reject_reason TEXT,
    tier TEXT,
    cost NUMERIC(40,0),
    client_nonce TEXT,
    epoch_id BIGINT,
    success BOOLEAN,
    rarity TEXT,
    draws JSONB,
    pet_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  );
  CREATE INDEX catch_user_day ON catch_attempts(user_id, created_at);

  CREATE TABLE battles (
    id TEXT PRIMARY KEY,
    a_pet TEXT NOT NULL,
    b_pet TEXT NOT NULL,
    winner TEXT,
    epoch_id BIGINT NOT NULL,
    label TEXT NOT NULL,
    inputs JSONB NOT NULL,
    result JSONB NOT NULL,
    stolen JSONB NOT NULL,
    mode TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX battles_a ON battles(a_pet, created_at);
  CREATE INDEX battles_b ON battles(b_pet, created_at);

  CREATE TABLE daily_claims (
    pet_id TEXT NOT NULL,
    day DATE NOT NULL,
    amount NUMERIC(40,0) NOT NULL,
    draws JSONB NOT NULL,
    PRIMARY KEY (pet_id, day)
  );

  -- Durable outbox for onchain work (mints, settlement batches, withdrawals).
  CREATE TABLE outbox (
    id BIGSERIAL PRIMARY KEY,
    idem TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- In-game marketplace. One open listing per asset, enforced by partial unique indexes.
  CREATE TABLE listings (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL REFERENCES users(id),
    pet_id TEXT REFERENCES pets(id),
    equipment_id TEXT REFERENCES equipment(id),
    price NUMERIC(40,0) NOT NULL CHECK (price > 0),
    status TEXT NOT NULL DEFAULT 'open',
    buyer_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    CONSTRAINT one_asset CHECK ((pet_id IS NULL) <> (equipment_id IS NULL))
  );
  CREATE UNIQUE INDEX listings_open_pet ON listings(pet_id) WHERE status = 'open' AND pet_id IS NOT NULL;
  CREATE UNIQUE INDEX listings_open_eq ON listings(equipment_id) WHERE status = 'open' AND equipment_id IS NOT NULL;

  CREATE TABLE kv (
    k TEXT PRIMARY KEY,
    v JSONB NOT NULL
  );

  CREATE TABLE admin_log (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail JSONB NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding JSONB
  `,
];
