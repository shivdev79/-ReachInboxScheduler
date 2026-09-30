import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export const redisConfig = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

let redisClient: Redis | null = null;
let isRedisAvailable = false;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      ...redisConfig,
      connectTimeout: 2000,
      retryStrategy(times) {
        if (times > 2) {
          return null; // Stop retrying after 2 attempts
        }
        return 500;
      }
    });

    redisClient.on('connect', () => {
      isRedisAvailable = true;
      console.log('✅ Connected to Redis successfully');
    });

    redisClient.on('error', () => {
      isRedisAvailable = false;
    });
  }
  return redisClient;
}

export function checkRedisAvailable(): boolean {
  return isRedisAvailable;
}
