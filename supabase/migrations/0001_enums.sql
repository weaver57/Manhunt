-- =============================================================================
-- Migration 0001: Core enums and extensions
-- =============================================================================

-- Enable PostGIS for geospatial queries (distance calculations)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pgcrypto for random code generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE game_status AS ENUM (
  'lobby',      -- waiting for players
  'starting',   -- countdown in progress
  'active',     -- game running
  'paused',     -- host paused
  'ended'       -- game over
);

CREATE TYPE game_mode AS ENUM (
  'classic',
  'royale',
  'team',
  'infection',
  'vip',
  'relay'
);

CREATE TYPE player_role AS ENUM (
  'runner',
  'chaser',
  'spectator'
);

CREATE TYPE player_status AS ENUM (
  'waiting',       -- in lobby
  'active',        -- playing
  'tagged',        -- caught
  'sos',           -- SOS triggered
  'disconnected'   -- lost connection
);
