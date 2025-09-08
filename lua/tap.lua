-- Atomic tap counting with cap and reward calculation
-- KEYS[1] = daily taps key (e.g., tap:{userId}:{yyyymmdd})
-- KEYS[2] = dogg balance key (e.g., balance:dogg:{userId})
-- ARGV[1] = increment (taps in this batch)
-- ARGV[2] = dailyCap (e.g., 200)
-- ARGV[3] = expireSeconds (ttl to end-of-day)
-- ARGV[4] = awardEvery (e.g., 10 taps per 1 $DOGG)

local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local inc = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local awardEvery = tonumber(ARGV[4])

local remaining = cap - current
if remaining < 0 then remaining = 0 end
local allowed = inc
if allowed > remaining then allowed = remaining end

local newTotal = current + allowed

if allowed > 0 then
  redis.call('SET', KEYS[1], newTotal)
  if ttl > 0 then
    redis.call('EXPIRE', KEYS[1], ttl)
  end
end

local prevAwards = math.floor(current / awardEvery)
local newAwards = math.floor(newTotal / awardEvery)
local deltaAwards = newAwards - prevAwards

local newBalance = tonumber(redis.call('GET', KEYS[2]) or '0')
if deltaAwards > 0 then
  newBalance = redis.call('INCRBY', KEYS[2], deltaAwards)
end

return {allowed, newTotal, deltaAwards, tonumber(newBalance)}

