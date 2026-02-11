import * as mammoth from 'mammoth';

/**
 * Extract text from a PDF file
 * @param file PDF file to process
 * @returns Promise with extracted text
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  console.log(`Preparing to extract text from PDF file: ${file.name}, size: ${file.size} bytes`);
  
  // The actual extraction happens on the server side through the upload endpoint
  // This is just a client-side placeholder for compatibility with the extractTextFromFile function
  return "PDF processing will be handled on the server side.";
}

/**
 * Extract text from a DOCX file
 * @param file DOCX file to process
 * @returns Promise with extracted text
 */
export async function extractTextFromDOCX(file: File): Promise<string> {
  console.log(`Preparing to extract text from DOCX file: ${file.name}, size: ${file.size} bytes`);
  
  // The actual extraction happens on the server side through the upload endpoint
  // This is just a client-side placeholder for compatibility with the extractTextFromFile function
  return "DOCX processing will be handled on the server side.";
}

/**
 * Extract text from a text file
 * @param file Text file to process
 * @returns Promise with extracted text
 */
export async function extractTextFromTXT(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        resolve(text);
      } catch (error: any) {
        reject(new Error(`Failed to extract text from TXT: ${error.message}`));
      }
    };
    reader.onerror = (event) => {
      reject(new Error('Failed to read TXT file'));
    };
    reader.readAsText(file);
  });
}

/**
 * Extract text from a file based on its type
 * @param file File to process (PDF, DOCX, or TXT)
 * @returns Promise with extracted text
 */
export async function extractTextFromFile(file: File): Promise<string> {
  console.log(`Checking file format for: ${file.name}`);
  const fileName = file.name.toLowerCase();
  
  if (fileName.endsWith('.pdf')) {
    console.log('PDF file detected, using server-side extraction');
    return extractTextFromPDF(file);
  } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    console.log('DOCX file detected, using server-side extraction');
    return extractTextFromDOCX(file);
  } else if (fileName.endsWith('.txt')) {
    console.log('TXT file detected, using client-side extraction');
    return extractTextFromTXT(file);
  } else {
    console.error(`Unsupported file format: ${fileName}`);
    throw new Error('Unsupported file format. Please upload a PDF, DOCX, or TXT file.');
  }
}