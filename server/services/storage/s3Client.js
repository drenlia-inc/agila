/**
 * S3-compatible client helpers (AWS S3, MinIO, R2, etc.).
 * Loaded lazily so disk-only startups do not require @aws-sdk/client-s3 until used.
 */

/**
 * @returns {Promise<typeof import('@aws-sdk/client-s3')>}
 */
async function loadAwsS3() {
  try {
    return await import('@aws-sdk/client-s3');
  } catch (err) {
    const msg =
      err?.code === 'ERR_MODULE_NOT_FOUND'
        ? 'Package @aws-sdk/client-s3 is not installed. Rebuild the app image (docker compose build) or run npm install.'
        : err?.message || 'Failed to load @aws-sdk/client-s3';
    throw new Error(msg);
  }
}

/**
 * @param {import('./storageConfig.js').StorageConfig} config
 */
/** True when endpoint is empty or the generic AWS S3 hostname (SDK should use region). */
function isAwsDefaultEndpoint(endpoint) {
  const e = String(endpoint || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  if (!e) return true;
  return (
    e === 'https://s3.amazonaws.com' ||
    e === 'http://s3.amazonaws.com' ||
    e === 's3.amazonaws.com'
  );
}

export async function createS3Client(config) {
  const { S3Client } = await loadAwsS3();
  const accessKeyId = String(config?.accessKeyId ?? '').trim();
  const secretAccessKey = String(config?.secretAccessKey ?? '').trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3 credentials are incomplete (access key or secret missing)');
  }

  const clientConfig = {
    region: String(config?.region || 'us-east-1').trim() || 'us-east-1',
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  };

  // For real AWS, omit Endpoint so the SDK talks to the regional endpoint
  // (https://s3.<region>.amazonaws.com). Forcing https://s3.amazonaws.com causes
  // "Please re-send this request to the specified temporary endpoint" for non-us-east-1 buckets.
  const customEndpoint = String(config?.endpoint || '').trim();
  if (customEndpoint && !isAwsDefaultEndpoint(customEndpoint)) {
    clientConfig.endpoint = customEndpoint;
    // Path-style is usually required for MinIO / custom endpoints; optional override via setting.
    clientConfig.forcePathStyle = config.forcePathStyle !== false;
  } else if (config.forcePathStyle) {
    clientConfig.forcePathStyle = true;
  }

  return new S3Client(clientConfig);
}

/**
 * @param {any} client
 * @param {import('./storageConfig.js').StorageConfig} config
 * @param {string} key
 * @param {Buffer | Uint8Array | string} body
 * @param {string} [contentType]
 */
export async function s3Put(client, config, key, body, contentType) {
  const { PutObjectCommand } = await loadAwsS3();
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream'
    })
  );
}

/**
 * @param {any} client
 * @param {import('./storageConfig.js').StorageConfig} config
 * @param {string} key
 * @returns {Promise<{ body: import('stream').Readable, contentType?: string } | null>}
 */
export async function s3Get(client, config, key) {
  const { GetObjectCommand } = await loadAwsS3();
  try {
    const out = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key
      })
    );
    if (!out.Body) return null;
    return {
      body: out.Body,
      contentType: out.ContentType || undefined
    };
  } catch (err) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * @param {any} client
 * @param {import('./storageConfig.js').StorageConfig} config
 * @param {string} key
 */
export async function s3Delete(client, config, key) {
  const { DeleteObjectCommand } = await loadAwsS3();
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
  );
}

/**
 * Delete every object under a key prefix (paginated ListObjectsV2 + DeleteObjects).
 * Refuses an empty prefix so we never wipe an entire bucket by accident.
 *
 * @param {any} client
 * @param {import('./storageConfig.js').StorageConfig} config
 * @param {string} prefix
 * @returns {Promise<{ deleted: number, prefix: string }>}
 */
export async function s3DeleteByPrefix(client, config, prefix) {
  const { ListObjectsV2Command, DeleteObjectsCommand } = await loadAwsS3();
  let normalized = String(prefix || '').trim().replace(/^\/+/, '');
  if (normalized && !normalized.endsWith('/')) normalized += '/';
  if (!normalized) {
    throw new Error('Refusing S3 prefix delete: empty key prefix');
  }

  let deleted = 0;
  let continuationToken;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: normalized,
        ContinuationToken: continuationToken
      })
    );
    const contents = listed.Contents || [];
    for (let i = 0; i < contents.length; i += 1000) {
      const chunk = contents.slice(i, i + 1000).filter((o) => o?.Key);
      if (chunk.length === 0) continue;
      const out = await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: {
            Objects: chunk.map((o) => ({ Key: o.Key })),
            Quiet: true
          }
        })
      );
      const errors = out.Errors || [];
      if (errors.length > 0) {
        const sample = errors
          .slice(0, 3)
          .map((e) => `${e.Key}: ${e.Code || e.Message}`)
          .join('; ');
        throw new Error(`S3 prefix delete failed for ${errors.length} object(s): ${sample}`);
      }
      deleted += chunk.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  return { deleted, prefix: normalized };
}

/**
 * @param {any} client
 * @param {import('./storageConfig.js').StorageConfig} config
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function s3Exists(client, config, key) {
  const { HeadObjectCommand } = await loadAwsS3();
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: key
      })
    );
    return true;
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * Stream / AWS SDK body to Buffer.
 * @param {any} body
 * @returns {Promise<Buffer>}
 */
export async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
