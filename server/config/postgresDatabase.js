/**
 * PostgreSQL Database Adapter
 *
 * Async prepare/get/all/run API over node-pg Pool.
 * Queries are executed as-is (Postgres SQL). The only dialect bridge is
 * converting SQLite-style `?` placeholders to `$1, $2, $3`.
 *
 * Usage:
 *   const db = new PostgresDatabase(tenantId);
 *   const stmt = db.prepare('SELECT * FROM users WHERE id = $1');
 *   const user = await stmt.get(userId);
 *
 * Notes:
 * - All statement methods are async
 * - Schema search_path is set per client in multi-tenant mode
 */

import pg from 'pg';
const { Pool } = pg;

class PostgresStatement {
  constructor(db, query) {
    this.db = db;
    this.query = query;
    this.source = query; // For compatibility with queryLogger
    this.dbProxy = db; // For compatibility with dbAsync / wrapQuery
  }

  // Convert SQLite-style ? placeholders to PostgreSQL $1, $2, $3
  convertPlaceholders(query, params) {
    if (params.length === 0) return { query, params };

    let paramIndex = 1;
    const convertedQuery = query.replace(/\?/g, () => `$${paramIndex++}`);
    return { query: convertedQuery, params };
  }

  async get(...params) {
    const { query, params: convertedParams } = this.convertPlaceholders(this.query, params);
    const client = await this.db.getClient();
    try {
      const result = await client.query(query, convertedParams);
      return result.rows[0] || null;
    } finally {
      this.db.releaseClient(client);
    }
  }

  async all(...params) {
    const { query, params: convertedParams } = this.convertPlaceholders(this.query, params);
    const client = await this.db.getClient();
    try {
      const result = await client.query(query, convertedParams);
      return result.rows;
    } finally {
      this.db.releaseClient(client);
    }
  }

  async run(...params) {
    const { query, params: convertedParams } = this.convertPlaceholders(this.query, params);
    const client = await this.db.getClient();
    try {
      const result = await client.query(query, convertedParams);
      return {
        changes: result.rowCount || 0,
        lastInsertRowid: result.rows[0]?.id || null
      };
    } finally {
      this.db.releaseClient(client);
    }
  }

  getSync(...params) {
    throw new Error('Synchronous methods not supported in PostgreSQL. Use async methods.');
  }

  allSync(...params) {
    throw new Error('Synchronous methods not supported in PostgreSQL. Use async methods.');
  }

  runSync(...params) {
    throw new Error('Synchronous methods not supported in PostgreSQL. Use async methods.');
  }
}

class PostgresDatabase {
  constructor(tenantId = null, options = {}) {
    this.tenantId = tenantId;
    this.closed = false;
    this.schema = tenantId && process.env.MULTI_TENANT === 'true' ? `tenant_${tenantId}` : 'public';
    this.transactionClient = null;

    const database = options.database || process.env.POSTGRES_DB;
    if (!database) {
      throw new Error('POSTGRES_DB is required (set env POSTGRES_DB or pass options.database)');
    }

    const host = options.host || process.env.POSTGRES_HOST || 'localhost';
    if (!process.env.POSTGRES_HOST && !options.host) {
      console.warn('⚠️ POSTGRES_HOST not set; defaulting to localhost');
    }

    // Multi-tenant + multi-pod: each tenant gets its own Pool. Default 20 × tenants ×
    // replicas easily exhausts Postgres max_connections (seen: ~75 idle conns per pod).
    const envMax = parseInt(process.env.POSTGRES_POOL_MAX || '', 10);
    const defaultMax =
      process.env.MULTI_TENANT === 'true' || process.env.MULTI_TENANT === '1' ? 5 : 20;
    const poolMax = options.max || (Number.isFinite(envMax) && envMax > 0 ? envMax : defaultMax);

    const config = {
      host,
      port: options.port || parseInt(process.env.POSTGRES_PORT || '5432'),
      database,
      user: options.user || process.env.POSTGRES_USER || 'postgres',
      password: options.password || process.env.POSTGRES_PASSWORD || 'postgres',
      max: poolMax,
      idleTimeoutMillis: options.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: options.connectionTimeoutMillis || 10000,
    };

    this.pool = new Pool(config);
  }

  async getClient() {
    if (this.closed) {
      throw new Error('Database connection is closed');
    }

    if (this.transactionClient) {
      return this.transactionClient;
    }

    const client = await this.pool.connect();

    if (this.schema !== 'public') {
      const quotedSchema = `"${this.schema}"`;
      // Tenant-only search_path (no public fallback). If the schema is missing,
      // Postgres would otherwise silently use public and pollute shared tables.
      try {
        await client.query(`SET search_path TO ${quotedSchema}`);
        const check = await client.query(
          `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
          [this.schema]
        );
        if (!check.rows.length) {
          throw new Error(
            `Tenant schema "${this.schema}" does not exist (refusing public fallback)`
          );
        }
      } catch (error) {
        client.release();
        throw error;
      }
    }

    return client;
  }

  releaseClient(client) {
    if (client && client !== this.transactionClient) {
      client.release();
    }
  }

  prepare(query) {
    if (this.closed) {
      throw new Error('Database connection is closed');
    }
    return new PostgresStatement(this, query);
  }

  async exec(sql) {
    if (this.closed) {
      throw new Error('Database connection is closed');
    }

    const client = await this.getClient();

    try {
      const statements = sql.split(';').filter(s => s.trim());
      const errors = [];

      for (const stmt of statements) {
        if (stmt.trim()) {
          let cleaned = stmt.trim();
          const lines = cleaned.split('\n');
          const nonCommentLines = [];
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('--')) {
              nonCommentLines.push(line);
            }
          }
          cleaned = nonCommentLines.join('\n').trim();

          if (!cleaned || cleaned.startsWith('--')) {
            continue;
          }

          try {
            if (
              process.env.LOG_PG_CREATE_TABLE === 'true' &&
              cleaned.toUpperCase().startsWith('CREATE TABLE')
            ) {
              const tableMatch = cleaned.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["']?(\w+)["']?/i);
              if (tableMatch) {
                console.log(`🔧 Executing CREATE TABLE for: ${tableMatch[1]}`);
              }
            }

            await client.query(cleaned);
          } catch (error) {
            if (error.code === '42P07' || error.code === '42710') {
              continue;
            }

            console.error(`❌ SQL execution error (code: ${error.code}): ${error.message}`);
            console.error(`   Statement: ${cleaned.substring(0, 200)}...`);

            errors.push({ statement: cleaned.substring(0, 50), error: error.message || 'Unknown error', code: error.code });
          }
        }
      }

      if (errors.length > 0) {
        const errorDetails = errors.map(e => `  - ${e.error} (code: ${e.code || 'unknown'}) in: ${e.statement}...`).join('\n');
        throw new Error(`Error executing SQL (${errors.length} error(s)):\n${errorDetails}`);
      }
    } finally {
      this.releaseClient(client);
    }
  }

  transaction(callback) {
    if (this.closed) {
      throw new Error('Database connection is closed');
    }

    return async (...args) => {
      const client = await this.pool.connect();
      this.transactionClient = client;

      try {
        await client.query('BEGIN');

        if (this.schema !== 'public') {
          const quotedSchema = `"${this.schema}"`;
          await client.query(`SET LOCAL search_path TO ${quotedSchema}`);
        }
        const result = await callback(...args);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        this.transactionClient = null;
        client.release();
      }
    };
  }

  async pragma() {
    throw new Error('PRAGMA not supported (PostgreSQL adapter)');
  }

  /**
   * Execute a batch of queries in a single transaction
   * @param {Array<{query: string, params: Array}>} queries
   * @returns {Promise<Array>}
   */
  async executeBatchTransaction(queries) {
    if (this.closed) {
      throw new Error('Database connection is closed');
    }

    if (!Array.isArray(queries) || queries.length === 0) {
      return [];
    }

    console.log(`📦 [PostgresDatabase] Executing batched transaction: ${queries.length} queries`);
    const startTime = Date.now();

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      if (this.schema !== 'public') {
        const quotedSchema = `"${this.schema}"`;
        await client.query(`SET LOCAL search_path TO ${quotedSchema}`);
      }

      const results = [];
      for (const { query, params = [] } of queries) {
        const convertedQuery = this.convertPlaceholdersInQuery(query, params);
        const result = await client.query(convertedQuery.query, convertedQuery.params);
        results.push(result);
      }

      await client.query('COMMIT');

      const duration = Date.now() - startTime;
      console.log(`✅ [PostgresDatabase] Batched transaction completed in ${duration}ms for ${queries.length} queries`);

      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      const duration = Date.now() - startTime;
      console.error(`❌ [PostgresDatabase] Batched transaction failed after ${duration}ms:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  convertPlaceholdersInQuery(query, params) {
    if (params.length === 0) return { query, params };

    let paramIndex = 1;
    const convertedQuery = query.replace(/\?/g, () => `$${paramIndex++}`);
    return { query: convertedQuery, params };
  }

  async close() {
    await this.pool.end();
    this.closed = true;
  }

  get backup() {
    throw new Error('Backup not supported in PostgreSQL adapter');
  }

  get checkpoint() {
    throw new Error('Checkpoint not supported in PostgreSQL adapter');
  }

  get function() {
    throw new Error('Custom functions not supported in PostgreSQL adapter');
  }

  async ensureSchema(options = {}) {
    if (this.schema === 'public') {
      return;
    }

    const provision = options.provision === true;
    const adminClient = await this.pool.connect();
    try {
      const exists = await adminClient.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [this.schema]
      );
      if (exists.rows.length) {
        return;
      }
      if (!provision) {
        throw new Error(`Tenant schema "${this.schema}" does not exist`);
      }
      const quotedSchema = `"${this.schema}"`;
      await adminClient.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
      const check = await adminClient.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [this.schema]
      );
      if (!check.rows.length) {
        throw new Error(`Failed to create tenant schema "${this.schema}"`);
      }
      console.log(`✅ Schema '${this.schema}' ready for tenant: ${this.tenantId}`);
    } catch (error) {
      if (error.code !== '42P06') {
        throw error;
      }
    } finally {
      adminClient.release();
    }
  }

  /**
   * True when this adapter's tenant schema (and settings table) exist.
   * Used to invalidate stale dbCache entries after DROP SCHEMA / destroy.
   */
  async tenantSchemaIsReady() {
    if (this.schema === 'public') {
      return true;
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'settings'
         LIMIT 1`,
        [this.schema]
      );
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }
}

export default PostgresDatabase;
