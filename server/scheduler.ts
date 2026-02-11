import * as cron from 'node-cron';
import { syncAllActiveFeeds } from './rssCrawler';
import { storage } from './storage';
import { fetchDailyArxivPapers, seedFoundationArxivPapers } from './arxivCrawler';
import { fetchWeeklyTopBook, seedFoundationClassics } from './gutenbergCrawler';

interface SchedulerState {
  isRunning: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  jobs: Map<string, cron.ScheduledTask>;
}

class CrawlerScheduler {
  private state: SchedulerState = {
    isRunning: false,
    lastRun: null,
    nextRun: null,
    jobs: new Map()
  };

  // RSS 피드 자동 동기화 시작 (12시간마다 실행)
  startRSSScheduler() {
    const jobName = 'rss-sync';
    
    if (this.state.jobs.has(jobName)) {
      this.state.jobs.get(jobName)?.stop();
      this.state.jobs.delete(jobName);
    }

    const task = cron.schedule('0 */12 * * *', async () => {
      console.log('[SCHEDULER] Starting RSS feed sync check...');
      this.state.lastRun = new Date();
      
      try {
        await syncAllActiveFeeds();
        console.log('[SCHEDULER] RSS feed sync check completed successfully');
      } catch (error) {
        console.error('[SCHEDULER] RSS feed sync check failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    this.state.jobs.set(jobName, task);
    task.start();
    this.updateNextRunTime(jobName);
    console.log('[SCHEDULER] RSS feed scheduler started - runs every 12 hours');
    return true;
  }

  // arXiv 일일 크롤러 (월-금, 매일 오전 9시 KST)
  startArxivDailyScheduler() {
    const jobName = 'arxiv-daily';
    
    if (this.state.jobs.has(jobName)) {
      this.state.jobs.get(jobName)?.stop();
      this.state.jobs.delete(jobName);
    }

    // 월-금 오전 9시 (0-4 = 일-목 이지만, cron에서는 1-5 = 월-금)
    const task = cron.schedule('0 9 * * 1-5', async () => {
      console.log('[SCHEDULER] Starting daily arXiv fetch (cs.AI, cs.CL)...');
      this.state.lastRun = new Date();
      
      try {
        const result = await fetchDailyArxivPapers();
        if (result.success) {
          console.log(`[SCHEDULER] arXiv daily fetch completed: ${result.papersAdded} papers added`);
        } else {
          console.warn(`[SCHEDULER] arXiv daily fetch partial: ${result.error}`);
        }
      } catch (error) {
        console.error('[SCHEDULER] arXiv daily fetch failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    this.state.jobs.set(jobName, task);
    task.start();
    this.updateNextRunTime(jobName);
    console.log('[SCHEDULER] arXiv daily scheduler started - runs Mon-Fri at 9 AM KST');
    return true;
  }

  // Gutenberg 주간 크롤러 (월요일 오전 6시 KST)
  startGutenbergWeeklyScheduler() {
    const jobName = 'gutenberg-weekly';
    
    if (this.state.jobs.has(jobName)) {
      this.state.jobs.get(jobName)?.stop();
      this.state.jobs.delete(jobName);
    }

    // 매주 월요일 오전 6시
    const task = cron.schedule('0 6 * * 1', async () => {
      console.log('[SCHEDULER] Starting weekly Gutenberg Top 100 fetch...');
      this.state.lastRun = new Date();
      
      try {
        const result = await fetchWeeklyTopBook();
        if (result.success) {
          console.log(`[SCHEDULER] Gutenberg weekly fetch completed: ${result.bookTitle}`);
        } else {
          console.warn(`[SCHEDULER] Gutenberg weekly fetch failed: ${result.error}`);
        }
      } catch (error) {
        console.error('[SCHEDULER] Gutenberg weekly fetch failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    this.state.jobs.set(jobName, task);
    task.start();
    this.updateNextRunTime(jobName);
    console.log('[SCHEDULER] Gutenberg weekly scheduler started - runs Monday at 6 AM KST');
    return true;
  }

  // 자동 만료 문서 정리 (매일 새벽 3시)
  startExpirationCleanupScheduler() {
    const jobName = 'expiration-cleanup';
    
    if (this.state.jobs.has(jobName)) {
      this.state.jobs.get(jobName)?.stop();
      this.state.jobs.delete(jobName);
    }

    const task = cron.schedule('0 3 * * *', async () => {
      console.log('[SCHEDULER] Starting expired documents cleanup...');
      this.state.lastRun = new Date();
      
      try {
        const result = await this.cleanupExpiredDocuments();
        console.log(`[SCHEDULER] Expired documents cleanup completed: ${result.removed} removed`);
      } catch (error) {
        console.error('[SCHEDULER] Expiration cleanup failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    this.state.jobs.set(jobName, task);
    task.start();
    this.updateNextRunTime(jobName);
    console.log('[SCHEDULER] Expiration cleanup scheduler started - runs daily at 3 AM KST');
    return true;
  }

  // 만료된 문서 정리
  async cleanupExpiredDocuments(): Promise<{ removed: number; errors: string[] }> {
    const errors: string[] = [];
    let removed = 0;

    try {
      const allDocs = await storage.getAllDocuments();
      const now = new Date();
      
      for (const doc of allDocs) {
        // is_permanent 문서는 만료되지 않음
        if (doc.isPermanent) continue;
        
        // expires_at이 설정되어 있고 현재 시간을 지났으면 삭제
        if (doc.expiresAt && new Date(doc.expiresAt) < now) {
          try {
            await storage.deleteDocument(doc.id);
            console.log(`[SCHEDULER] Removed expired document: ${doc.title} (ID: ${doc.id})`);
            removed++;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            errors.push(`Failed to delete doc ${doc.id}: ${errMsg}`);
          }
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    return { removed, errors };
  }

  // 30개 문서 제한 강제 (permanent 제외)
  async enforceDocumentLimit(): Promise<{ removed: number }> {
    const LIMIT = 30;
    let removed = 0;

    try {
      const allDocs = await storage.getAllDocuments();
      
      // permanent가 아닌 arXiv/Gutenberg 문서만 필터
      const nonPermanentDocs = allDocs.filter(doc => 
        !doc.isPermanent && 
        (doc.source === 'arXiv' || doc.source === 'Project Gutenberg')
      );
      
      // 날짜순 정렬 (오래된 것 먼저)
      nonPermanentDocs.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });
      
      // 초과분 삭제
      if (nonPermanentDocs.length > LIMIT) {
        const toRemove = nonPermanentDocs.slice(0, nonPermanentDocs.length - LIMIT);
        for (const doc of toRemove) {
          try {
            await storage.deleteDocument(doc.id);
            console.log(`[SCHEDULER] Removed over-limit document: ${doc.title}`);
            removed++;
          } catch (err) {
            console.error(`[SCHEDULER] Failed to remove document ${doc.id}:`, err);
          }
        }
      }
    } catch (error) {
      console.error('[SCHEDULER] Error enforcing document limit:', error);
    }

    return { removed };
  }

  // 모든 소스 통합 동기화 (하루에 한 번)
  startUnifiedScheduler() {
    const jobName = 'unified-sync';
    
    if (this.state.jobs.has(jobName)) {
      this.state.jobs.get(jobName)?.stop();
      this.state.jobs.delete(jobName);
    }

    const task = cron.schedule('0 2 * * *', async () => {
      console.log('[SCHEDULER] Starting unified content sync...');
      this.state.lastRun = new Date();
      
      try {
        await syncAllActiveFeeds();
        console.log('[SCHEDULER] Unified content sync completed successfully');
      } catch (error) {
        console.error('[SCHEDULER] Unified content sync failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    this.state.jobs.set(jobName, task);
    task.start();
    this.updateNextRunTime(jobName);
    console.log('[SCHEDULER] Unified scheduler started - runs daily at 2 AM');
    return true;
  }

  // 수동 동기화 트리거
  async triggerManualSync(sourceType: 'rss' | 'arxiv' | 'gutenberg' | 'all' | 'system' = 'all') {
    console.log(`[SCHEDULER] Manual sync triggered for: ${sourceType}`);
    
    try {
      if (sourceType === 'rss' || sourceType === 'all') {
        await syncAllActiveFeeds();
      }
      
      if (sourceType === 'arxiv' || sourceType === 'system' || sourceType === 'all') {
        console.log('[SCHEDULER] Starting arXiv sync...');
        const result = await fetchDailyArxivPapers();
        console.log(`[SCHEDULER] arXiv sync completed: ${result.papersAdded} papers added`);
      }
      
      if (sourceType === 'gutenberg' || sourceType === 'system' || sourceType === 'all') {
        console.log('[SCHEDULER] Starting Gutenberg sync...');
        const result = await fetchWeeklyTopBook();
        console.log(`[SCHEDULER] Gutenberg sync completed: ${result.success ? result.bookTitle : result.error}`);
      }
      
      // 문서 제한 강제
      await this.enforceDocumentLimit();
      
      this.state.lastRun = new Date();
      console.log(`[SCHEDULER] Manual sync completed for: ${sourceType}`);
      return { success: true, timestamp: this.state.lastRun };
    } catch (error) {
      console.error(`[SCHEDULER] Manual sync failed for ${sourceType}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Foundation Classics 시딩 (초기 설정용)
  async seedFoundationContent() {
    console.log('[SCHEDULER] Seeding Foundation Content...');
    
    try {
      // arXiv Foundation Papers
      await seedFoundationArxivPapers();
      
      // Gutenberg Foundation Classics
      await seedFoundationClassics();
      
      console.log('[SCHEDULER] Foundation content seeding completed');
      return { success: true };
    } catch (error) {
      console.error('[SCHEDULER] Foundation seeding failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  getStatus() {
    const activeJobs = Array.from(this.state.jobs.entries()).map(([name, task]) => ({
      name,
      running: task.getStatus() === 'scheduled',
      status: task.getStatus() === 'scheduled' ? 'active' : 'stopped'
    }));

    return {
      ...this.state,
      jobs: activeJobs,
      isRunning: activeJobs.some(job => job.running)
    };
  }

  stopJob(jobName: string) {
    const task = this.state.jobs.get(jobName);
    if (task) {
      task.stop();
      console.log(`[SCHEDULER] Stopped job: ${jobName}`);
      return true;
    }
    return false;
  }

  stopAll() {
    this.state.jobs.forEach((task, name) => {
      task.stop();
      console.log(`[SCHEDULER] Stopped job: ${name}`);
    });
    this.state.jobs.clear();
    this.state.isRunning = false;
    console.log('[SCHEDULER] All scheduled jobs stopped');
  }

  private updateNextRunTime(jobName: string) {
    const now = new Date();
    let nextRun: Date;
    
    if (jobName === 'rss-sync') {
      nextRun = new Date(now);
      const currentHour = nextRun.getHours();
      const nextScheduleHour = currentHour < 12 ? 12 : 24;
      if (nextScheduleHour >= 24) {
        nextRun.setDate(nextRun.getDate() + 1);
        nextRun.setHours(0, 0, 0, 0);
      } else {
        nextRun.setHours(nextScheduleHour, 0, 0, 0);
      }
    } else if (jobName === 'unified-sync') {
      nextRun = new Date(now);
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(2, 0, 0, 0);
    } else if (jobName === 'arxiv-daily') {
      nextRun = new Date(now);
      const dayOfWeek = nextRun.getDay(); // 0=Sun, 1=Mon, ...
      if (dayOfWeek === 0) {
        nextRun.setDate(nextRun.getDate() + 1); // Skip Sunday
      } else if (dayOfWeek === 6) {
        nextRun.setDate(nextRun.getDate() + 2); // Skip Saturday
      } else if (nextRun.getHours() >= 9) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      nextRun.setHours(9, 0, 0, 0);
    } else if (jobName === 'gutenberg-weekly') {
      nextRun = new Date(now);
      const daysUntilMonday = (8 - nextRun.getDay()) % 7 || 7;
      nextRun.setDate(nextRun.getDate() + daysUntilMonday);
      nextRun.setHours(6, 0, 0, 0);
    } else if (jobName === 'expiration-cleanup') {
      nextRun = new Date(now);
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(3, 0, 0, 0);
    } else {
      nextRun = now;
    }
    
    this.state.nextRun = nextRun;
  }
}

export const crawlerScheduler = new CrawlerScheduler();

export function initializeScheduler() {
  console.log('[SCHEDULER] Initializing crawler scheduler...');
  
  crawlerScheduler.startRSSScheduler();
  crawlerScheduler.startUnifiedScheduler();
  crawlerScheduler.startArxivDailyScheduler();
  crawlerScheduler.startGutenbergWeeklyScheduler();
  crawlerScheduler.startExpirationCleanupScheduler();
  
  console.log('[SCHEDULER] Crawler scheduler initialized successfully');
}

export function shutdownScheduler() {
  console.log('[SCHEDULER] Shutting down scheduler...');
  crawlerScheduler.stopAll();
}
