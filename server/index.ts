import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { seedDatabase } from "./seed";
import { initializeScheduler, shutdownScheduler } from "./scheduler";
import { handleImageProxy } from "./imageProxy.js";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage.js";
import { spawn } from "child_process";
import { pool } from "./db.js";

const app = express();
const PgSession = connectPgSimple(session);

// Trust proxy for rate limiting and proper IP detection
// Configure trust proxy more securely for rate limiting
app.set('trust proxy', 1); // Trust first proxy only

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// Session configuration for OAuth
app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'readacross-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
  },
}));

// Debug middleware for Content-Type and body parsing
app.use((req, res, next) => {
  if (req.path.startsWith('/api/admin')) {
    console.log(`[MIDDLEWARE] ${req.method} ${req.path}`);
    console.log(`[MIDDLEWARE] Content-Type: ${req.headers['content-type']}`);
    console.log(`[MIDDLEWARE] Body:`, req.body);
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Test database connection
  const { testDatabaseConnection } = await import("./db.js");
  const dbConnectionOk = await testDatabaseConnection();
  if (!dbConnectionOk) {
    console.error("Failed to establish database connection. Exiting...");
    process.exit(1);
  }

  // Seed the database with initial data
  await seedDatabase();

  // Initialize new RSS sources based on instructions.md
  try {
    const { initializeNewSources } = await import("./rssCrawler.js");
    await initializeNewSources();
    console.log("[INIT] New RSS sources initialized successfully");
  } catch (error) {
    console.error("[INIT] Failed to initialize new RSS sources:", error);
  }

  // Initialize the automatic crawler scheduler
  initializeScheduler();

  // Initialize PDF extractor and log availability
  try {
    const { initializePdfExtractor } = await import("./pdfUtils.js");
    await initializePdfExtractor();
  } catch (error) {
    console.error("[INIT] Failed to initialize PDF extractor:", error);
  }

  // Auto-seed Project Gutenberg content for Explore tab (run in background)
  (async () => {
    try {
      // Check if we already have public documents
      const { storage } = await import("./storage.js");
      const existingPublicDocs = await storage.getPublicLibraryDocuments({});

      // Check for Gutenberg content - seed if less than 15 Foundation Classics
      const gutenbergDocs = existingPublicDocs.filter(doc => doc.source === "Project Gutenberg");
      if (gutenbergDocs.length < 15) {
        const { seedGutenbergBooks } = await import("./gutenbergCrawler.js");
        console.log(`Starting automatic Project Gutenberg seeding (${gutenbergDocs.length}/15 Foundation Classics)...`);
        await seedGutenbergBooks();
        console.log("Project Gutenberg seeding completed successfully!");
      } else {
        console.log(`Found ${gutenbergDocs.length} Gutenberg documents (all Foundation Classics seeded)`);
      }

      // Check for arXiv content
      const arxivDocs = existingPublicDocs.filter(doc => doc.source === "arXiv");
      if (arxivDocs.length === 0) {
        const { seedArxivPapers } = await import("./arxivCrawler.js");
        console.log("Starting automatic arXiv papers seeding...");
        await seedArxivPapers();
        console.log("arXiv papers seeding completed successfully!");
      } else {
        console.log(`Found ${arxivDocs.length} existing arXiv documents, skipping arXiv seeding`);
      }

      // Set expiration dates for existing documents that don't have them
      await storage.setExpirationDatesForExistingDocuments();

    } catch (error) {
      console.error("Failed to seed public content:", error);
      // Don't fail the app startup if seeding fails
    }
  })();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Image proxy endpoint
  app.get("/api/image-proxy", handleImageProxy);

  // Thumbnail serving endpoint
  app.get("/api/thumbnails/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      const objectStorage = new ObjectStorageService();

      // Construct the full path for the thumbnail
      const privateDir = objectStorage.getPrivateObjectDir();
      const thumbnailPath = `${privateDir}/thumbnails/${filename}`;

      const file = await objectStorage.getThumbnailFile(thumbnailPath);
      await objectStorage.downloadObject(file, res, 3600); // Cache for 1 hour
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Thumbnail not found" });
      } else {
        console.error("Error serving thumbnail:", error);
        res.status(500).json({ error: "Failed to serve thumbnail" });
      }
    }
  });

  // Routes are registered in registerRoutes() function called above

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use.`);
      console.error('Please restart the application to resolve the port conflict.');
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });

  // Graceful shutdown handler
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Shutting down gracefully...');
    shutdownScheduler();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Shutting down gracefully...');
    shutdownScheduler();
    process.exit(0);
  });
})();