import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  hmacSecret: process.env.HMAC_SECRET,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
  useInMemory: String(process.env.USE_INMEMORY || 'false').toLowerCase() === 'true',
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'example',
    database: process.env.MYSQL_DATABASE || 'tap_api'
  },
  mysqlSkip: String(process.env.SKIP_MYSQL || 'false').toLowerCase() === 'true',
  rules: {
    dailyCap: Number(process.env.DAILY_TAP_CAP || 200),
    awardEvery: Number(process.env.AWARD_EVERY_N_TAPS || 10),
    maxBatchTaps: 100,
    tsSkewSec: 120
  },
  ton: {
    endpointUrl: process.env.TON_ENDPOINT_URL,
    apiKey: process.env.TON_API_KEY,
    mnemonic: process.env.TON_MNEMONIC,
    workchain: Number(process.env.TON_WALLET_WORKCHAIN || 0),
    dogNftContract: process.env.DOGG_NFT_COLLECTION_ADDRESS || null
  },
  dryRun: String(process.env.DRY_RUN || 'true').toLowerCase() === 'true'
};

if (!config.hmacSecret) {
  console.warn('[config] HMAC_SECRET is not set. Set it in your environment for security.');
}
