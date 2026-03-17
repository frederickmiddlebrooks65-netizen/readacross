#!/usr/bin/env python3
"""
PDF Layout Extractor using PyMuPDF (fitz)
Extracts text lines with position information for layout-first processing

Output: JSON array of TextLine objects
{ page: int, y: float, xStart: float, xEnd: float, text: string, fontHeight: float }
"""

import sys
import json
import os
import io
import fitz  # PyMuPDF

def sort_page_lines_in_reading_order(page_lines: list, page_width: float, page_height: float) -> list:
    """
    Sort lines from a single page in correct reading order, handling multi-column layouts.

    Detection logic:
    - Analyzes xStart distribution across body lines
    - If >15% of body lines start in the right half (>40% of page width), it's likely 2-column
    - Full-width lines (spanning >60% of page width) act as section dividers
    - Reading order: left column top→bottom, then right column top→bottom per section
    """
    if not page_lines:
        return page_lines

    # Identify body zone (exclude header/footer margins)
    margin_top = page_height * 0.07
    margin_bottom = page_height * 0.93

    body_lines = [
        l for l in page_lines
        if l["y"] >= margin_top and l["y"] <= margin_bottom and len(l["text"].strip()) > 10
    ]

    # Detect 2-column layout: count body lines starting in "right zone" (x > 40% of page)
    right_zone_x = page_width * 0.40
    right_zone_lines = [l for l in body_lines if l["xStart"] > right_zone_x]
    right_zone_ratio = len(right_zone_lines) / len(body_lines) if body_lines else 0

    if right_zone_ratio < 0.15:
        # Single-column: simple y-order sort
        return sorted(page_lines, key=lambda l: (l["y"], l["xStart"]))

    # 2-column layout detected
    # Find the column boundary: midpoint between left column's rightmost edge and right column's leftmost start
    # Exclude full-width lines (title, abstract, spanning headings) from left_max_end calculation —
    # their xEnd reaches ~88% of page width which would push col_boundary too far right,
    # causing all right-column lines to be misclassified into left_col.
    left_zone_lines = [l for l in body_lines if l["xStart"] <= right_zone_x]
    actual_left_lines = [l for l in left_zone_lines if l["xEnd"] <= page_width * 0.65]
    left_max_end = max((l["xEnd"] for l in actual_left_lines), default=right_zone_x * 0.6)
    right_min_start = min((l["xStart"] for l in right_zone_lines), default=right_zone_x)
    col_boundary = (left_max_end + right_min_start) / 2

    # Classify each line on the page
    # Full-width: wide lines spanning most of the page (headings, captions spanning both columns)
    full_width_min_width = page_width * 0.55
    left_col = []
    right_col = []
    full_width = []

    for l in page_lines:
        line_width = l["xEnd"] - l["xStart"]
        spans_both = l["xStart"] < col_boundary * 0.7 and l["xEnd"] > page_width * 0.75
        if line_width >= full_width_min_width or spans_both:
            full_width.append(l)
        elif l["xStart"] >= col_boundary:
            right_col.append(l)
        else:
            left_col.append(l)

    # Sort each group by y
    left_col.sort(key=lambda l: l["y"])
    right_col.sort(key=lambda l: l["y"])
    full_width.sort(key=lambda l: l["y"])

    # Build reading order: within each section (delimited by full-width lines),
    # read left column top→bottom, then right column top→bottom
    result = []
    processed_y = -float("inf")

    for fw in full_width:
        section_left = [l for l in left_col if l["y"] > processed_y and l["y"] < fw["y"]]
        section_right = [l for l in right_col if l["y"] > processed_y and l["y"] < fw["y"]]
        result.extend(section_left)
        result.extend(section_right)
        result.append(fw)
        processed_y = fw["y"]

    # Remaining lines after the last full-width element (or all lines if no full-width)
    result.extend(l for l in left_col if l["y"] > processed_y)
    result.extend(l for l in right_col if l["y"] > processed_y)

    return result


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

        # Detect tables on this page (suppress PyMuPDF stdout warnings)
        try:
            old_stdout = sys.stdout
            sys.stdout = io.StringIO()
            try:
                tables = page.find_tables()
                for table in tables.tables:
                    tb = table.bbox
                    table_bboxes.append({
                        "page": page_number,
                        "bbox": [tb[0], tb[1], tb[2], tb[3]]
                    })
            finally:
                sys.stdout = old_stdout
        except Exception:
            pass

        # Get text blocks with detailed position info
        # Using "dict" mode for comprehensive text extraction
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)

        page_lines = []
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

                page_lines.append({
                    "page": page_number,
                    "y": bbox[1],  # top of line (yMin)
                    "xStart": bbox[0],  # left edge
                    "xEnd": bbox[2],  # right edge
                    "text": line_text.strip(),
                    "fontHeight": median_font
                })

        # Sort this page's lines in correct reading order (handles multi-column layouts)
        sorted_page_lines = sort_page_lines_in_reading_order(
            page_lines, page_rect.width, page_rect.height
        )
        lines.extend(sorted_page_lines)

    doc.close()

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
