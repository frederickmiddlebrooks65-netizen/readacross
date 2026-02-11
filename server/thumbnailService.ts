import { ObjectStorageService } from "./objectStorage";
import Parser from "rss-parser";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import crypto from "crypto";
import { encode } from "blurhash";

interface ThumbnailExtractionResult {
  thumbnailPath?: string;
  thumbnailUrl?: string;
  originalImageUrl?: string;
  dominantColor?: string;
  blurhash?: string;
  status: "completed" | "failed" | "no_image";
}

export class ThumbnailService {
  private objectStorage: ObjectStorageService;
  private rssParser: Parser;

  constructor() {
    this.objectStorage = new ObjectStorageService();
    this.rssParser = new Parser({
      customFields: {
        item: [
          ['media:thumbnail', 'mediaThumbnail'],
          ['media:content', 'mediaContent'],
          ['enclosure', 'enclosure'],
          ['image', 'image']
        ]
      }
    });
  }

  /**
   * Extract thumbnail from various sources for a document
   */
  async extractThumbnail(sourceType: 'rss' | 'html' | 'url' | 'text', sourceData: any): Promise<ThumbnailExtractionResult> {
    try {
      let imageUrl: string | null = null;

      switch (sourceType) {
        case 'rss':
          imageUrl = await this.extractFromRSSItem(sourceData);
          break;
        case 'html':
          imageUrl = await this.extractFromHTML(sourceData.html, sourceData.url);
          break;
        case 'url':
          imageUrl = await this.extractFromURL(sourceData.url);
          break;
        case 'text':
          // For text documents, try to generate a text-based thumbnail
          return await this.generateTextBasedThumbnail(sourceData);
      }

      if (!imageUrl) {
        // For HTML/URL without images, try text-based generation if content is available
        if (sourceType === 'html' && sourceData.html) {
          return await this.generateTextBasedThumbnail({
            title: sourceData.title || 'Document',
            content: this.extractTextFromHTML(sourceData.html)
          });
        }
        return { status: "no_image" };
      }

      // Download and process the image
      const result = await this.downloadAndProcessImage(imageUrl);
      return result;

    } catch (error) {
      console.error("Error extracting thumbnail:", error);
      return { status: "failed" };
    }
  }

  /**
   * Extract image URL from RSS item
   */
  private async extractFromRSSItem(item: any): Promise<string | null> {
    // Try media:thumbnail first
    if (item.mediaThumbnail?.url) {
      return item.mediaThumbnail.url;
    }

    // Try media:content
    if (item.mediaContent?.url) {
      return item.mediaContent.url;
    }

    // Try enclosure (for podcasts/media)
    if (item.enclosure?.url && this.isImageUrl(item.enclosure.url)) {
      return item.enclosure.url;
    }

    // Try image field
    if (item.image && typeof item.image === 'string') {
      return item.image;
    }

    // Parse content/description for images
    const content = item.content || item.description || item.summary || item.extractedContent || '';
    if (content) {
      const imageUrl = this.extractImageFromHTML(content);
      if (imageUrl) return imageUrl;
    }

    // If no image found in RSS data, try the fallback URL (fetch full article)
    if (item.fallbackUrl) {
      console.log(`No image in RSS data, trying to extract from article URL: ${item.fallbackUrl}`);
      return await this.extractFromURL(item.fallbackUrl);
    }

    return null;
  }

  /**
   * Extract image URL from HTML content
   */
  private async extractFromHTML(html: string, baseUrl?: string): Promise<string | null> {
    try {
      const dom = new JSDOM(html);
      const document = dom.window.document;

      // Try Open Graph image
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) {
        const content = ogImage.getAttribute('content');
        if (content) return this.resolveUrl(content, baseUrl);
      }

      // Try Twitter image
      const twitterImage = document.querySelector('meta[name="twitter:image"]');
      if (twitterImage) {
        const content = twitterImage.getAttribute('content');
        if (content) return this.resolveUrl(content, baseUrl);
      }

      // Try to find the first significant image
      const images = document.querySelectorAll('img');
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const src = img.getAttribute('src');
        if (src && this.isSignificantImage(img)) {
          return this.resolveUrl(src, baseUrl);
        }
      }

      return null;
    } catch (error) {
      console.error("Error parsing HTML:", error);
      return null;
    }
  }

  /**
   * Extract image URL from a webpage URL
   */
  private async extractFromURL(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ReadAcross-Bot/1.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      return await this.extractFromHTML(html, url);
    } catch (error) {
      console.error("Error fetching URL:", error);
      return null;
    }
  }

  /**
   * Download and process image
   */
  private async downloadAndProcessImage(imageUrl: string): Promise<ThumbnailExtractionResult> {
    try {
      // Validate URL (only HTTPS)
      if (!imageUrl.startsWith('https://')) {
        throw new Error("Only HTTPS URLs are allowed");
      }

      // Download image
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ReadAcross-Bot/1.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!this.isValidImageType(contentType)) {
        throw new Error("Invalid image type");
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Check file size (max 10MB)
      if (buffer.length > 10 * 1024 * 1024) {
        throw new Error("Image too large");
      }

      // Resize and optimize image
      const resizedBuffer = await this.resizeImage(buffer);
      
      // Generate unique filename
      const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
      const fileName = `thumbnail_${Date.now()}_${hash}.webp`;
      
      const thumbnailPath = await this.objectStorage.uploadThumbnail(resizedBuffer, 'image/webp', fileName);
      const thumbnailUrl = await this.objectStorage.getThumbnailUrl(thumbnailPath);

      // Extract dominant color and blurhash
      const [dominantColor, blurhash] = await Promise.all([
        this.extractDominantColor(resizedBuffer),
        this.generateBlurHash(resizedBuffer)
      ]);

      return {
        thumbnailPath,
        thumbnailUrl,
        originalImageUrl: imageUrl,
        dominantColor,
        blurhash,
        status: "completed"
      };

    } catch (error) {
      console.error("Error processing image:", error);
      return { status: "failed" };
    }
  }

  /**
   * Extract image from HTML string
   */
  private extractImageFromHTML(html: string): string | null {
    try {
      const dom = new JSDOM(html);
      const document = dom.window.document;
      
      // Try multiple image selectors in order of preference
      const selectors = [
        'img[src*="themarginalian"]', // Site-specific images
        'img[class*="wp-image"]', // WordPress images
        'img[class*="featured"]', // Featured images
        'img[class*="main"]', // Main content images
        'figure img', // Images in figure tags
        'p img', // Images in paragraphs
        'img' // Any image as fallback
      ];

      for (const selector of selectors) {
        const imgs = document.querySelectorAll(selector);
        for (let i = 0; i < imgs.length; i++) {
          const img = imgs[i] as Element;
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && this.isImageUrl(src) && this.isSignificantImage(img)) {
            console.log(`Found image with selector ${selector}: ${src}`);
            return src;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting image from HTML:', error);
      return null;
    }
  }

  /**
   * Check if URL looks like an image
   */
  private isImageUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
    const lowerUrl = url.toLowerCase();
    
    // Direct extension check
    if (imageExtensions.some(ext => lowerUrl.includes(ext))) {
      return true;
    }
    
    // Common image hosting patterns
    const imagePatterns = [
      'image', 'photo', 'thumbnail', 'picture', 'pic',
      'themarginalian.org', 'wp-content', 'uploads',
      'media', 'assets', 'cdn', 'imgur', 'flickr'
    ];
    
    return imagePatterns.some(pattern => lowerUrl.includes(pattern));
  }

  /**
   * Check if image is significant (not too small, not ads)
   */
  private isSignificantImage(img: Element): boolean {
    const src = img.getAttribute('src') || '';
    const width = parseInt(img.getAttribute('width') || '0');
    const height = parseInt(img.getAttribute('height') || '0');
    const alt = img.getAttribute('alt') || '';
    const className = img.getAttribute('class') || '';

    // Skip small images
    if (width > 0 && height > 0 && (width < 100 || height < 100)) {
      return false;
    }

    // Skip likely ads or icons
    if (src.includes('ad') || src.includes('banner') || 
        alt.includes('ad') || className.includes('ad') ||
        src.includes('icon') || src.includes('logo')) {
      return false;
    }

    return true;
  }

  /**
   * Resolve relative URL to absolute
   */
  private resolveUrl(url: string, baseUrl?: string): string {
    if (url.startsWith('http')) {
      return url;
    }
    
    if (baseUrl) {
      try {
        return new URL(url, baseUrl).toString();
      } catch {
        return url;
      }
    }
    
    return url;
  }

  /**
   * Check if content type is valid image
   */
  private isValidImageType(contentType: string): boolean {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    return validTypes.some(type => contentType.includes(type));
  }

  /**
   * Resize image to thumbnail size
   */
  private async resizeImage(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(480, 270, {
          fit: 'cover',
          position: 'center'
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (error) {
      console.error("Error resizing image:", error);
      // Fallback to original buffer
      return buffer;
    }
  }

  /**
   * Extract dominant color from image buffer using sharp
   */
  private async extractDominantColor(buffer: Buffer): Promise<string> {
    try {
      const { data } = await sharp(buffer)
        .resize(1, 1)
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      if (data && data.length >= 3) {
        const r = data[0];
        const g = data[1];
        const b = data[2];
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }
      
      return '#6B7280'; // fallback gray-500
    } catch (error) {
      console.error("Error extracting color:", error);
      return '#6B7280'; // fallback gray-500
    }
  }

  /**
   * Generate blurhash for progressive image loading
   */
  private async generateBlurHash(buffer: Buffer): Promise<string> {
    try {
      const { data, info } = await sharp(buffer)
        .resize(32, 32, { fit: 'cover' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const blurhash = encode(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
        4,
        4
      );

      return blurhash;
    } catch (error) {
      console.error("Error generating blurhash:", error);
      return 'LGF5=}t4H=og0eR]t4azjqtUX8m';  // fallback blurhash for gray
    }
  }

  /**
   * Generate text-based thumbnail for documents without images
   */
  private async generateTextBasedThumbnail(data: { title?: string; content?: string }): Promise<ThumbnailExtractionResult> {
    try {
      // For now, return no_image status for text-only documents
      // This allows them to use the typography-based design
      return {
        status: "no_image",
        dominantColor: this.getRandomColor(),
      };
    } catch (error) {
      console.error("Error generating text-based thumbnail:", error);
      return { status: "failed" };
    }
  }

  /**
   * Extract text content from HTML
   */
  private extractTextFromHTML(html: string): string {
    try {
      const dom = new JSDOM(html);
      return dom.window.document.body?.textContent || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Get random color for text-based thumbnails
   */
  private getRandomColor(): string {
    const colors = [
      '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
      '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}