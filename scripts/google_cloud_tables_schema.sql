-- ============================================================================
-- GOOGLE CLOUD BIGQUERY & FIRESTORE ANALYTICS SCHEMA
-- Project: gen-lang-client-0222003829
-- Dataset: littlestep_analytics
-- Target: Spaces, Plants Chosen, Milestones, Rewards, and Points for Every User
-- ============================================================================

-- 1. SPACES STORED TABLE
-- Stores spatial configurations, floor area, dimensions, lighting and airflow zones for every user
CREATE TABLE IF NOT EXISTS `littlestep_analytics.spaces_stored` (
  space_id STRING NOT NULL OPTIONS(description="Unique space identifier"),
  user_id STRING NOT NULL OPTIONS(description="Owner Firebase Auth UID"),
  space_name STRING NOT NULL OPTIONS(description="Display name given to the room/zone"),
  space_type STRING OPTIONS(description="balcony, room, patio, or windowsill"),
  usable_area_sq_ft FLOAT64 OPTIONS(description="Measured usable square feet"),
  length_ft FLOAT64 OPTIONS(description="Room length dimension in feet"),
  width_ft FLOAT64 OPTIONS(description="Room width dimension in feet"),
  plant_capacity_estimate INT64 OPTIONS(description="Estimated botanical capacity count"),
  zones_json STRING OPTIONS(description="JSON serialized light, humidity and airflow sub-zones"),
  created_at TIMESTAMP OPTIONS(description="Timestamp when space was initially mapped"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp of latest modification"),
  data_source STRING DEFAULT 'cloud' OPTIONS(description="cloud or verified telemetry")
)
PARTITION BY DATE(updated_at)
CLUSTER BY user_id, space_type;

-- 2. PLANTS CHOSEN TABLE
-- Stores botanical species chosen and adopted by every user
CREATE TABLE IF NOT EXISTS `littlestep_analytics.plants_chosen` (
  adoption_id STRING NOT NULL OPTIONS(description="Unique plant adoption identifier"),
  user_id STRING NOT NULL OPTIONS(description="Owner Firebase Auth UID"),
  species_id STRING NOT NULL OPTIONS(description="Botanical species identifier from catalog"),
  common_name STRING NOT NULL OPTIONS(description="Vernacular botanical common name"),
  nickname STRING OPTIONS(description="User customized plant name"),
  space_id STRING OPTIONS(description="Linked space identifier"),
  zone_id STRING OPTIONS(description="Specific placement zone in space"),
  health_status STRING OPTIONS(description="thriving, healthy, or needs-attention"),
  streak_days INT64 OPTIONS(description="Consecutive daily care streak"),
  total_survival_days INT64 OPTIONS(description="Total lifespan under user stewardship"),
  water_frequency_days INT64 OPTIONS(description="Recommended watering interval in days"),
  adopted_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp when plant was chosen/adopted"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp of latest care check or update"),
  data_source STRING DEFAULT 'cloud' OPTIONS(description="cloud or verified telemetry")
)
PARTITION BY DATE(adopted_at)
CLUSTER BY user_id, species_id;

-- 3. MILESTONES REACHED TABLE
-- Stores botanical growth, survival, and care milestones reached across every user
CREATE TABLE IF NOT EXISTS `littlestep_analytics.milestones_reached` (
  milestone_id STRING NOT NULL OPTIONS(description="Unique milestone achievement identifier"),
  user_id STRING NOT NULL OPTIONS(description="Achiever Firebase Auth UID"),
  adoption_id STRING OPTIONS(description="Associated plant adoption identifier"),
  plant_name STRING OPTIONS(description="Plant name or nickname achieving milestone"),
  milestone_key STRING OPTIONS(description="Canonical milestone key e.g. survival_day_30"),
  title STRING NOT NULL OPTIONS(description="Display title of the milestone achieved"),
  description STRING OPTIONS(description="Milestone requirement context"),
  points_awarded INT64 OPTIONS(description="Reward points credited for this milestone"),
  category STRING OPTIONS(description="growth, survival, consistency, or environmental"),
  achieved_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp when milestone was reached"),
  data_source STRING DEFAULT 'cloud' OPTIONS(description="cloud or verified telemetry")
)
PARTITION BY DATE(achieved_at)
CLUSTER BY user_id, category;

-- 4. REWARDS REDEEMED TABLE
-- Stores all reward redemptions and incentives claimed by every user
CREATE TABLE IF NOT EXISTS `littlestep_analytics.rewards_redeemed` (
  redemption_id STRING NOT NULL OPTIONS(description="Unique redemption identifier"),
  user_id STRING NOT NULL OPTIONS(description="Redeeming Firebase Auth UID"),
  reward_id STRING NOT NULL OPTIONS(description="Catalog reward item identifier"),
  reward_title STRING NOT NULL OPTIONS(description="Title of redeemed merchandise/service"),
  category STRING OPTIONS(description="pots, tools, seeds, soil, or eco_credits"),
  points_cost INT64 NOT NULL OPTIONS(description="Points spent to claim reward"),
  is_redeemed BOOL NOT NULL OPTIONS(description="Verification flag"),
  redeemed_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp when reward was redeemed"),
  data_source STRING DEFAULT 'cloud' OPTIONS(description="cloud or verified telemetry")
)
PARTITION BY DATE(redeemed_at)
CLUSTER BY user_id, reward_id;

-- 5. POINTS SCORED TABLE
-- Stores all point transactions earned or spent across every user action
CREATE TABLE IF NOT EXISTS `littlestep_analytics.points_scored` (
  transaction_id STRING NOT NULL OPTIONS(description="Unique point transaction identifier"),
  user_id STRING NOT NULL OPTIONS(description="Owner Firebase Auth UID"),
  action_type STRING NOT NULL OPTIONS(description="Action e.g. space_assessed, care_completed, milestone_reached"),
  points INT64 NOT NULL OPTIONS(description="Signed integer delta of points"),
  reason STRING OPTIONS(description="Human-readable context of the point score"),
  entity_id STRING OPTIONS(description="Related space, adoption, or milestone ID"),
  recorded_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp when points were recorded"),
  verified BOOL DEFAULT TRUE OPTIONS(description="Server verified transaction status"),
  data_source STRING DEFAULT 'cloud' OPTIONS(description="cloud or verified telemetry")
)
PARTITION BY DATE(recorded_at)
CLUSTER BY user_id, action_type;

-- 6. UNIFIED TELEMETRY EVENTS STREAMING TABLE
-- Ingests real-time streaming behavioral & analytics events
CREATE TABLE IF NOT EXISTS `littlestep_analytics.telemetry_events` (
  event_id STRING NOT NULL OPTIONS(description="Deduplicated event ID"),
  event_type STRING NOT NULL OPTIONS(description="Canonical event type"),
  user_id STRING NOT NULL OPTIONS(description="User UID or anonymous session"),
  entity_id STRING OPTIONS(description="Target entity ID"),
  entity_type STRING OPTIONS(description="Target entity category"),
  metadata STRING OPTIONS(description="JSON serialized metadata string"),
  environment STRING OPTIONS(description="development, staging, or production"),
  timestamp TIMESTAMP NOT NULL OPTIONS(description="Event generation timestamp")
)
PARTITION BY DATE(timestamp)
CLUSTER BY user_id, event_type;
