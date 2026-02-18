import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

// Configure WebSocket for Neon with better error handling and retries
neonConfig.webSocketConstructor = ws;
neonConfig.wsProxy = (host) => `${host}:443/v2`;
neonConfig.useSecureWebSocket = true;
neonConfig.pipelineConnect = false;
neonConfig.pipelineTLS = false;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
});

export const db = drizzle({ client: pool, schema });

// Add connection error handling
pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

// Test connection on startup
export async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    console.log('[DATABASE] Connection test successful');
    client.release();
    return true;
  } catch (error) {
    console.error('[DATABASE] Connection test failed:', error);
    return false;
  }
}