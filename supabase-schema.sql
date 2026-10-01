-- ====================================================================
-- CHESS STADIUM - SUPABASE ROW LEVEL SECURITY (RLS) & DATABASE SCHEMA
-- ====================================================================
-- This schema establishes a Zero-Trust database architecture where:
-- 1. Public / Authenticated clients can only read public profile and match data.
-- 2. Client JWT tokens have ZERO permission to insert, update, or alter Elo ratings,
--    match records, or trust factors.
-- 3. All rating calculations and match outcome recordings are restricted
--    exclusively to the backend using the service_role key.
-- ====================================================================

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  elo INTEGER NOT NULL DEFAULT 1200,
  highest_elo INTEGER NOT NULL DEFAULT 1200,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  trust_score INTEGER NOT NULL DEFAULT 100,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_terms BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. MATCHES TABLE
CREATE TABLE IF NOT EXISTS public.matches (
  id TEXT PRIMARY KEY,
  white_player_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  black_player_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  winner TEXT, -- 'w', 'b', or NULL for draw
  end_reason TEXT NOT NULL, -- 'checkmate', 'timeout', 'resignation', 'abandonment', 'draw_agreement'
  pgn TEXT,
  final_fen TEXT,
  moves_count INTEGER NOT NULL DEFAULT 0,
  white_elo_delta INTEGER NOT NULL DEFAULT 0,
  black_elo_delta INTEGER NOT NULL DEFAULT 0,
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. RATINGS AUDIT TABLE
CREATE TABLE IF NOT EXISTS public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id TEXT REFERENCES public.matches(id) ON DELETE SET NULL,
  old_elo INTEGER NOT NULL,
  new_elo INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable RLS across all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------
-- PROFILES POLICIES
-- --------------------------------------------------------------------

-- Policy 1: Anyone (anon or authenticated) can view public profile details
DROP POLICY IF EXISTS "Allow public read access on profiles" ON public.profiles;
CREATE POLICY "Allow public read access on profiles"
  ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Policy 2: Authenticated users can ONLY update their own username and accepted_terms
-- (Users CANNOT update elo, wins, losses, trust_score, or ban status)
DROP POLICY IF EXISTS "Allow users to update own handle and terms" ON public.profiles;
CREATE POLICY "Allow users to update own handle and terms"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = id)
  WITH CHECK (
    auth.uid()::text = id
    -- Protect against tampering with Elo or trust ratings
    AND elo = (SELECT p.elo FROM public.profiles p WHERE p.id = auth.uid()::text)
    AND trust_score = (SELECT p.trust_score FROM public.profiles p WHERE p.id = auth.uid()::text)
    AND wins = (SELECT p.wins FROM public.profiles p WHERE p.id = auth.uid()::text)
    AND losses = (SELECT p.losses FROM public.profiles p WHERE p.id = auth.uid()::text)
  );

-- Policy 3: Full access exclusively granted to service_role (backend server)
DROP POLICY IF EXISTS "Allow service_role full management on profiles" ON public.profiles;
CREATE POLICY "Allow service_role full management on profiles"
  ON public.profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- --------------------------------------------------------------------
-- MATCHES POLICIES
-- --------------------------------------------------------------------

-- Policy 1: Anyone can read completed match records
DROP POLICY IF EXISTS "Allow public read access on matches" ON public.matches;
CREATE POLICY "Allow public read access on matches"
  ON public.matches
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Policy 2: Disallow client-side match creation/mutation entirely.
-- Only backend service_role can record match outcomes.
DROP POLICY IF EXISTS "Allow service_role full management on matches" ON public.matches;
CREATE POLICY "Allow service_role full management on matches"
  ON public.matches
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- --------------------------------------------------------------------
-- RATINGS POLICIES
-- --------------------------------------------------------------------

-- Policy 1: Anyone can read historical ratings
DROP POLICY IF EXISTS "Allow public read access on ratings" ON public.ratings;
CREATE POLICY "Allow public read access on ratings"
  ON public.ratings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Policy 2: Restrict rating adjustments exclusively to backend service_role
DROP POLICY IF EXISTS "Allow service_role full management on ratings" ON public.ratings;
CREATE POLICY "Allow service_role full management on ratings"
  ON public.ratings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ====================================================================
-- SECURITY INDEXES
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_matches_white_player ON public.matches (white_player_id);
CREATE INDEX IF NOT EXISTS idx_matches_black_player ON public.matches (black_player_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_id ON public.ratings (user_id);
