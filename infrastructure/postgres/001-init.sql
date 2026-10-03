CREATE TABLE IF NOT EXISTS contracts (id uuid PRIMARY KEY, title text NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS plans (id uuid PRIMARY KEY, name text NOT NULL, discipline integer NOT NULL CHECK (discipline BETWEEN 0 AND 5), artifact text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action text NOT NULL, entity_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
