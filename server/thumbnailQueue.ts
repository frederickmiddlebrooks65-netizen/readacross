import { ThumbnailService } from "./thumbnailService";
import { storage } from "./storage";

interface ThumbnailJob {
  documentId: number;
  sourceType: 'rss' | 'html' | 'url';
  sourceData: any;
  priority: 'high' | 'normal' | 'low';
}

export class ThumbnailQueue {
  private queue: ThumbnailJob[] = [];
  private processing = false;
  private thumbnailService: ThumbnailService;

  constructor() {
    this.thumbnailService = new ThumbnailService();
  }

  /**
   * Add a thumbnail extraction job to the queue
   */
  async addJob(job: ThumbnailJob): Promise<void> {
    // Check if document already has a thumbnail or is being processed
    const document = await storage.getDocument(job.documentId);
    if (!document) {
      console.log(`Document ${job.documentId} not found, skipping thumbnail job`);
      return;
    }

    if (document.thumbnailStatus === 'success' || document.thumbnailStatus === 'processing') {
      console.log(`Document ${job.documentId} already has thumbnail or is processing, skipping`);
      return;
    }

    // Add to queue based on priority
    if (job.priority === 'high') {
      this.queue.unshift(job);
    } else {
      this.queue.push(job);
    }

    console.log(`Added thumbnail job for document ${job.documentId} (priority: ${job.priority})`);
    
    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Process jobs in the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;

      try {
        await this.processJob(job);
        
        // Add delay between jobs to be respectful to external services
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to process thumbnail job for document ${job.documentId}:`, error);
      }
    }

    this.processing = false;
  }

  /**
   * Process a single thumbnail job
   */
  private async processJob(job: ThumbnailJob): Promise<void> {
    console.log(`Processing thumbnail job for document ${job.documentId}`);

    try {
      // Update document status to processing
      await storage.updateDocument(job.documentId, { thumbnailStatus: "processing" });

      // Extract thumbnail
      const result = await this.thumbnailService.extractThumbnail(job.sourceType, job.sourceData);

      // Update document with thumbnail info
      const updateData: any = {
        thumbnailStatus: result.status === "completed" ? "success" : 
                        result.status === "no_image" ? "failed" : result.status,
        originalImageUrl: result.originalImageUrl || null,
        dominantColor: result.dominantColor || null
      };

      if (result.thumbnailPath && result.thumbnailUrl) {
        updateData.thumbnailPath = result.thumbnailPath;
        updateData.thumbnailUrl = result.thumbnailUrl;
      }

      await storage.updateDocument(job.documentId, updateData);
      console.log(`Thumbnail extraction completed for document ${job.documentId}: ${result.status}`);

    } catch (error) {
      console.error(`Thumbnail extraction failed for document ${job.documentId}:`, error);
      await storage.updateDocument(job.documentId, { thumbnailStatus: "failed" });
    }
  }

  /**
   * Get queue status
   */
  getStatus(): { queueLength: number; processing: boolean } {
    return {
      queueLength: this.queue.length,
      processing: this.processing
    };
  }

  /**
   * Clear the queue
   */
  clearQueue(): void {
    this.queue = [];
  }
}

// Global thumbnail queue instance
export const thumbnailQueue = new ThumbnailQueue();