import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client } from 'minio';

@Injectable()
export class MinioService {
  private readonly bucket = process.env.MINIO_BUCKET || 'pos-assets';
  private readonly region = process.env.MINIO_REGION || 'us-east-1';
  private readonly publicBaseUrl = process.env.MINIO_PUBLIC_URL;

  private readonly client = new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  });

  private bucketReady = false;

  private async ensureBucket() {
    if (this.bucketReady) return;
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, this.region);
    }

    const publicReadPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    });
    await this.client.setBucketPolicy(this.bucket, publicReadPolicy);

    this.bucketReady = true;
  }

  async uploadProductImage(buffer: Buffer, mimeType: string) {
    await this.ensureBucket();

    const objectKey = `products/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomUUID()}.webp`;

    await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });

    const imageUrl = this.publicBaseUrl
      ? `${this.publicBaseUrl.replace(/\/$/, '')}/${this.bucket}/${objectKey}`
      : await this.client.presignedGetObject(this.bucket, objectKey, 60 * 60 * 24 * 7);

    return { imageUrl, objectKey };
  }

  private extractObjectKeyFromUrl(imageUrl: string) {
    try {
      const parsed = new URL(imageUrl);
      const pathname = parsed.pathname.replace(/^\/+/, '');
      if (!pathname) return null;

      if (pathname.startsWith(`${this.bucket}/`)) {
        return pathname.slice(this.bucket.length + 1);
      }

      const bucketIndex = pathname.indexOf(`/${this.bucket}/`);
      if (bucketIndex >= 0) {
        return pathname.slice(bucketIndex + this.bucket.length + 2);
      }

      return null;
    } catch {
      const raw = imageUrl.replace(/^\/+/, '');
      if (raw.startsWith(`${this.bucket}/`)) {
        return raw.slice(this.bucket.length + 1);
      }
      return null;
    }
  }

  async deleteProductImageByUrl(imageUrl: string) {
    if (!imageUrl) return;
    const objectKey = this.extractObjectKeyFromUrl(imageUrl);
    if (!objectKey) return;

    await this.ensureBucket();
    try {
      await this.client.removeObject(this.bucket, objectKey);
    } catch {
      // Ignore missing object or cleanup failures
    }
  }
}
