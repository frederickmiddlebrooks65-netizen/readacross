/**
 * PDF Layout Extractor - Node.js Wrapper
 * Calls Python PyMuPDF extractor and returns structured TextLine data
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// TextLine interface matching Python extractor output
export interface TextLine {
  page: number;
  y: number;
  xStart: number;
  xEnd: number;
  text: string;
  fontHeight: number;
  origin?: { page: number; bbox: [number, number, number, number] };
  isTable?: boolean;
}

export interface TableBbox {
  page: number;
  bbox: [number, number, number, number]; // [x0, y0, x1, y1]
}

export interface PyMuPDFResult {
  lines: TextLine[];
  pageHeights: Record<number, number>;
  tableBboxes: TableBbox[];
  extractorVersion: string;
  error?: string;
}

// Cache for extractor availability check
let extractorAvailable: boolean | null = null;
let extractorVersion: string | null = null;

/**
 * Check if PyMuPDF extractor is available
 * Logs version on first check
 */
export async function checkPyMuPDFAvailable(): Promise<boolean> {
  if (extractorAvailable !== null) {
    return extractorAvailable;
  }

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn("python3", ["-c", "import fitz; print(fitz.version[0])"]);
      let output = "";
      let error = "";
      
      proc.stdout.on("data", (data) => (output += data.toString()));
      proc.stderr.on("data", (data) => (error += data.toString()));
      
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(error || "PyMuPDF not available"));
        }
      });
      
      proc.on("error", reject);
    });

    extractorVersion = result;
    extractorAvailable = true;
    console.log(`[PDF_EXTRACTOR] PyMuPDF available, version: ${extractorVersion}`);
    return true;
  } catch (error) {
    extractorAvailable = false;
    console.warn(`[PDF_EXTRACTOR] PyMuPDF not available:`, error);
    return false;
  }
}

/**
 * Get extractor version string
 */
export function getExtractorVersion(): string | null {
  return extractorVersion;
}

/**
 * Extract text lines from PDF using PyMuPDF
 * @param buffer PDF file buffer
 * @returns Promise<PyMuPDFResult>
 * @throws Error if extraction fails
 */
export async function extractPdfLines(buffer: Buffer): Promise<PyMuPDFResult> {
  // Write buffer to temp file
  const tempPath = path.join(os.tmpdir(), `pdf-pymupdf-${Date.now()}.pdf`);
  await fs.promises.writeFile(tempPath, buffer);

  try {
    const scriptPath = path.join(process.cwd(), "server", "pdfLayoutExtractor.py");
    
    return await new Promise<PyMuPDFResult>((resolve, reject) => {
      const proc = spawn("python3", [scriptPath, tempPath]);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`PyMuPDF extractor failed (code ${code}): ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout) as PyMuPDFResult;
          
          if (result.error) {
            reject(new Error(result.error));
            return;
          }

          resolve(result);
        } catch (parseError) {
          reject(new Error(`Failed to parse PyMuPDF output: ${parseError}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn PyMuPDF process: ${err.message}`));
      });
    });
  } finally {
    // Cleanup temp file
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}

/**
 * Initialize extractor and log availability on server startup
 */
export async function initializePdfExtractor(): Promise<void> {
  const available = await checkPyMuPDFAvailable();
  if (available) {
    console.log(`[PDF_EXTRACTOR] Initialization complete - PyMuPDF ${extractorVersion} ready`);
  } else {
    console.warn("[PDF_EXTRACTOR] Initialization complete - PyMuPDF NOT available, will use pdftotext fallback");
  }
}
