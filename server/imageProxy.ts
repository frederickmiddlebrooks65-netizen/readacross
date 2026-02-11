import { Request, Response } from 'express';
import sharp from 'sharp';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { URL } from 'url';

// Security: Allowed domains for image proxying to prevent abuse
const ALLOWED_DOMAINS = [
  'replit.com',
  'replit.app',
  'replitusercontent.com',
  'cdn.replit.com',
  'i.imgur.com',
  'imgur.com',
  'picsum.photos',
  'via.placeholder.com',
  'images.unsplash.com',
  'picsum.photos',
  'cdn.pixabay.com',
  'images.pexels.com',
  'storage.googleapis.com',
  'github.com',
  'raw.githubusercontent.com',
  'media.npr.org',
  'npr.brightspotcdn.com'
];

// Cache for processed images (in-memory, could be extended to Redis/disk)
const imageCache = new Map<string, { data: Buffer; contentType: string; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface ImageProxyOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'jpeg' | 'png';
  dpr?: number; // Device pixel ratio for retina displays
}

/**
 * Parse query parameters and validate image processing options
 */
function parseImageOptions(query: any): ImageProxyOptions {
  const options: ImageProxyOptions = {};

  // Parse width and height with validation
  if (query.width) {
    const width = parseInt(query.width);
    if (width > 0 && width <= 2000) {
      options.width = width;
    }
  }

  if (query.height) {
    const height = parseInt(query.height);
    if (height > 0 && height <= 2000) {
      options.height = height;
    }
  }

  // Parse quality (1-100)
  if (query.quality) {
    const quality = parseInt(query.quality);
    if (quality >= 1 && quality <= 100) {
      options.quality = quality;
    }
  }

  // Parse format preference
  if (query.format && ['webp', 'avif', 'jpeg', 'png'].includes(query.format)) {
    options.format = query.format;
  }

  // Parse device pixel ratio
  if (query.dpr) {
    const dpr = parseFloat(query.dpr);
    if (dpr > 0 && dpr <= 3) {
      options.dpr = dpr;
    }
  }

  return options;
}

/**
 * Determine optimal image format based on Accept header and options
 */
function determineFormat(acceptHeader: string | undefined, options: ImageProxyOptions): string {
  // If format is explicitly specified, use it
  if (options.format) {
    return options.format;
  }

  // Check Accept header for format preferences
  if (acceptHeader) {
    if (acceptHeader.includes('image/avif')) {
      return 'avif';
    }
    if (acceptHeader.includes('image/webp')) {
      return 'webp';
    }
  }

  // Default to JPEG for better compatibility
  return 'jpeg';
}

/**
 * Validate if the URL domain is allowed
 */
function isAllowedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase();
    
    // Check if domain or parent domain is in allowed list
    return ALLOWED_DOMAINS.some(allowed => 
      domain === allowed || domain.endsWith('.' + allowed)
    );
  } catch {
    return false;
  }
}

/**
 * Generate cache key for processed images
 */
function generateCacheKey(url: string, options: ImageProxyOptions, format: string): string {
  const key = `${url}:${JSON.stringify(options)}:${format}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Download image from URL with timeout and size limits
 */
async function downloadImage(url: string): Promise<{ data: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      signal: controller.signal as any, // Type assertion to fix compatibility
      headers: {
        'User-Agent': 'ReadAcross-ImageProxy/1.0',
        'Accept': 'image/webp,image/avif,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5'
      },
      size: 10 * 1024 * 1024 // 10MB limit
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      throw new Error('Response is not an image');
    }

    const data = await response.buffer();
    return { data, contentType };

  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Process image with Sharp based on options
 */
async function processImage(
  imageData: Buffer, 
  options: ImageProxyOptions, 
  outputFormat: string
): Promise<{ data: Buffer; contentType: string }> {
  let pipeline = sharp(imageData);

  // Apply DPR scaling
  let targetWidth = options.width;
  let targetHeight = options.height;
  
  if (options.dpr && options.dpr > 1) {
    if (targetWidth) targetWidth = Math.round(targetWidth * options.dpr);
    if (targetHeight) targetHeight = Math.round(targetHeight * options.dpr);
  }

  // Resize if dimensions specified
  if (targetWidth || targetHeight) {
    pipeline = pipeline.resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  // Apply format and quality
  const quality = options.quality || 85;
  
  switch (outputFormat) {
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
    case 'png':
      pipeline = pipeline.png({ quality });
      break;
    case 'jpeg':
    default:
      pipeline = pipeline.jpeg({ quality });
      break;
  }

  const processedData = await pipeline.toBuffer();
  const contentType = `image/${outputFormat}`;

  return { data: processedData, contentType };
}

/**
 * Clean expired items from cache
 */
function cleanCache(): void {
  const now = Date.now();
  // Use Array.from to fix iteration compatibility
  const entries = Array.from(imageCache.entries());
  for (const [key, item] of entries) {
    if (now - item.timestamp > CACHE_TTL) {
      imageCache.delete(key);
    }
  }
}

/**
 * Main image proxy handler
 */
export async function handleImageProxy(req: Request, res: Response): Promise<void> {
  try {
    const { url } = req.query;

    // Validate required parameters
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Missing or invalid url parameter' });
      return;
    }

    // Validate domain whitelist
    if (!isAllowedDomain(url)) {
      res.status(403).json({ error: 'Domain not allowed' });
      return;
    }

    // Parse processing options
    const options = parseImageOptions(req.query);
    const outputFormat = determineFormat(req.headers.accept, options);
    
    // Generate cache key
    const cacheKey = generateCacheKey(url, options, outputFormat);

    // Check cache first
    const cached = imageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      res.set({
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'HIT'
      });
      res.send(cached.data);
      return;
    }

    // Download original image
    const { data: originalData, contentType: originalContentType } = await downloadImage(url);

    // Process image if needed
    let finalData: Buffer;
    let finalContentType: string;

    if (Object.keys(options).length > 0 || outputFormat !== originalContentType.split('/')[1]) {
      // Processing needed
      const processed = await processImage(originalData, options, outputFormat);
      finalData = processed.data;
      finalContentType = processed.contentType;
    } else {
      // No processing needed, serve original
      finalData = originalData;
      finalContentType = originalContentType;
    }

    // Cache the result
    imageCache.set(cacheKey, {
      data: finalData,
      contentType: finalContentType,
      timestamp: Date.now()
    });

    // Clean old cache entries periodically
    if (Math.random() < 0.01) { // 1% chance
      cleanCache();
    }

    // Set response headers
    res.set({
      'Content-Type': finalContentType,
      'Content-Length': finalData.length.toString(),
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'X-Cache': 'MISS',
      'X-Processed': Object.keys(options).length > 0 ? 'true' : 'false'
    });

    res.send(finalData);

  } catch (error: any) {
    console.error('Image proxy error:', error);
    
    // Send appropriate error response
    if (error.name === 'AbortError') {
      res.status(408).json({ error: 'Request timeout' });
    } else if (error.message.includes('HTTP')) {
      res.status(502).json({ error: 'Failed to fetch image' });
    } else {
      res.status(500).json({ error: 'Image processing failed' });
    }
  }
}

/**
 * Get cache statistics (for debugging/monitoring)
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: imageCache.size,
    keys: Array.from(imageCache.keys())
  };
}