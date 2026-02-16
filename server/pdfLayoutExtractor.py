#!/usr/bin/env python3
"""
PDF Layout Extractor using PyMuPDF (fitz)
Extracts text lines with position information for layout-first processing

Output: JSON array of TextLine objects
{ page: int, y: float, xStart: float, xEnd: float, text: string, fontHeight: float }
"""

import sys
import json
import fitz  # PyMuPDF

def extract_lines_from_pdf(pdf_path: str) -> dict:
    """
    Extract text lines from PDF with position information.
    Returns dict with 'lines' array and 'pageHeights' dict.
    """
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        return {"error": f"Failed to open PDF: {str(e)}", "lines": [], "pageHeights": {}, "tableBboxes": []}
    
    lines = []
    page_heights = {}
    table_bboxes = []
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        page_number = page_num + 1  # 1-based page numbering
        page_rect = page.rect
        page_heights[page_number] = page_rect.height
        
        # Detect tables on this page
        try:
            tables = page.find_tables()
            for table in tables.tables:
                tb = table.bbox
                table_bboxes.append({
                    "page": page_number,
                    "bbox": [tb[0], tb[1], tb[2], tb[3]]
                })
        except Exception:
            pass
        
        # Get text blocks with detailed position info
        # Using "dict" mode for comprehensive text extraction
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        
        for block in blocks.get("blocks", []):
            if block.get("type") != 0:  # Skip non-text blocks (images, etc.)
                continue
            
            for line_data in block.get("lines", []):
                bbox = line_data.get("bbox", [0, 0, 0, 0])
                spans = line_data.get("spans", [])
                
                if not spans:
                    continue
                
                # Aggregate text from all spans in the line
                line_text = ""
                font_heights = []
                
                for span in spans:
                    text = span.get("text", "")
                    if text.strip():
                        line_text += text
                        font_heights.append(span.get("size", 12))
                
                if not line_text.strip():
                    continue
                
                # Calculate median font height for the line
                font_heights.sort()
                median_font = font_heights[len(font_heights) // 2] if font_heights else 12
                
                lines.append({
                    "page": page_number,
                    "y": bbox[1],  # top of line (yMin)
                    "xStart": bbox[0],  # left edge
                    "xEnd": bbox[2],  # right edge
                    "text": line_text.strip(),
                    "fontHeight": median_font
                })
    
    doc.close()
    
    # Sort lines by page, then by y position, then by x position
    lines.sort(key=lambda l: (l["page"], l["y"], l["xStart"]))
    
    return {
        "lines": lines,
        "pageHeights": page_heights,
        "tableBboxes": table_bboxes,
        "extractorVersion": f"pymupdf-{fitz.version[0]}"
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided", "lines": [], "pageHeights": {}}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    result = extract_lines_from_pdf(pdf_path)
    
    # Output as JSON to stdout
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
