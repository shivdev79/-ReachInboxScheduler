import { getRedisClient } from '../config/redis';

export function getCurrentHourWindow(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

export function getHourWindowStartMs(date: Date = new Date()): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  );
}

export async function claimRateLimitAlert(senderId: string, hourWindow: string): Promise<boolean> {
  const redis = getRedisClient();
  const result = await redis.set(
    `ratelimit-alert:sender:${senderId}:${hourWindow}`,
    '1',
    'EX',
    7200,
    'NX',
  );
  return result === 'OK';
}

export async function acquireSenderSendLock(params: {
  senderId: string;
  minimumDelayMs: number;
}): Promise<{ acquired: boolean; retryAfterMs: number; token: string | null }> {
  const minimumDelayMs = Math.max(0, params.minimumDelayMs);
  const nowMs = Date.now();
  const enforcedDelayMs = minimumDelayMs + Math.min(500, Math.max(250, Math.ceil(minimumDelayMs * 0.1)));
  const token = `${process.pid}-${nowMs}-${Math.random().toString(36).slice(2)}`;
  const redis = getRedisClient();
  const script = `
    local nowMs = tonumber(ARGV[1])
    local minimumDelayMs = tonumber(ARGV[2])
    local token = ARGV[3]
    local lockTtlMs = tonumber(ARGV[4])

    if redis.call('EXISTS', KEYS[1]) == 1 then
      return {0, 250, ''}
    end

    local lastStartMs = tonumber(redis.call('GET', KEYS[2]) or '0')
    local waitMs = lastStartMs + minimumDelayMs - nowMs
    if waitMs > 0 then
      return {0, waitMs, ''}
    end

    redis.call('SET', KEYS[1], token, 'PX', lockTtlMs)
    redis.call('SET', KEYS[2], nowMs, 'PX', 7200000)
    return {1, 0, token}
  `;
  const [acquired, retryAfterMs, lockToken] = await redis.eval(
    script,
    2,
    `rl:send-lock:${params.senderId}`,
    `rl:last-send:${params.senderId}`,
    nowMs,
    enforcedDelayMs,
    token,
    120000,
  ) as [number, number, string];
  return {
    acquired: Number(acquired) === 1,
    retryAfterMs: Number(retryAfterMs),
    token: lockToken || null,
  };
}

export async function releaseSenderSendLock(senderId: string, token: string): Promise<void> {
  const redis = getRedisClient();
  await redis.eval(`
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `, 1, `rl:send-lock:${senderId}`, token);
}

export async function checkAndIncrementRateLimit(params: {
  senderId: string;
  hourlyLimit: number;
  minimumDelayMs: number;
}): Promise<{
  allowed: boolean;
  waitMs: number;
  currentCount: number;
  hourWindow: string;
  hourWindowStartMs: number;
  nextWindowStart: Date;
}> {
  const now = new Date();
  const nowMs = now.getTime();
  const hourWindow = getCurrentHourWindow(now);
  const hourWindowStartMs = getHourWindowStartMs(now);
  const windowMs = 60 * 60 * 1000;
  const nextWindowStart = new Date(hourWindowStartMs + windowMs);
  const counterKey = `rl:count:${params.senderId}:${hourWindowStartMs}`;
  const slotKey = `rl:slot:${params.senderId}`;
  const reserveScript = `
    local nowMs = tonumber(ARGV[1])
    local hourlyLimit = tonumber(ARGV[2])
    local minDelayMs = tonumber(ARGV[3])
    local windowMs = tonumber(ARGV[4])
    local count = tonumber(redis.call('GET', KEYS[1]) or '0')

    if count >= hourlyLimit then
      return {0, windowMs - (nowMs % windowMs), count}
    end

    count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('PEXPIRE', KEYS[1], windowMs * 2)
    end

    local storedNextSlot = tonumber(redis.call('GET', KEYS[2]) or '0')
    local slot = math.max(nowMs, storedNextSlot)
    redis.call('SET', KEYS[2], slot + minDelayMs)
    return {1, slot - nowMs, count}
  `;

  const redis = getRedisClient();
  const [allowedValue, waitValue, countValue] = await redis.eval(
    reserveScript,
    2,
    counterKey,
    slotKey,
    nowMs,
    Math.max(1, params.hourlyLimit),
    Math.max(0, params.minimumDelayMs),
    windowMs,
  ) as [number, number, number];

  return {
    allowed: Number(allowedValue) === 1,
    waitMs: Number(waitValue),
    currentCount: Number(countValue),
    hourWindow,
    hourWindowStartMs,
    nextWindowStart,
  };
}
