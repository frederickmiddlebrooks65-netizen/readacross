import { useState, useEffect, useMemo, useRef, useCallback } from "react";

export interface PaginatedBlock {
  id: string | number;
  type: string;
  content: any;
  order: number;
}

export interface PageInfo {
  pageNumber: number;
  blocks: PaginatedBlock[];
  startBlockIndex: number;
  endBlockIndex: number;
}

interface UseBlockPaginationOptions {
  headerHeight?: number;
  footerHeight?: number;
  paginationControlsHeight?: number;
  blockGap?: number;
}

interface UseBlockPaginationResult {
  pages: PageInfo[];
  currentPageBlocks: PaginatedBlock[];
  currentPage: number;
  totalPages: number;
  pageHeight: number;
  setCurrentPage: (page: number) => void;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  goToPage: (page: number) => void;
  isInitialized: boolean;
}

export function useBlockPagination(
  blocks: PaginatedBlock[],
  options: UseBlockPaginationOptions = {}
): UseBlockPaginationResult {
  const {
    headerHeight = 0,
    footerHeight = 0,
    paginationControlsHeight = 96,
    blockGap = 24,
  } = options;

  const [currentPage, setCurrentPage] = useState(1);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initialPageHeight, setInitialPageHeight] = useState<number | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || blocks.length === 0) return;

    const calculateInitialPageHeight = () => {
      const viewportHeight = window.innerHeight;
      const calculatedHeight = viewportHeight - headerHeight - footerHeight - paginationControlsHeight;
      
      console.log('[PAGINATION] Initial page height calculation:', {
        viewportHeight,
        headerHeight,
        footerHeight,
        paginationControlsHeight,
        calculatedHeight,
      });

      setInitialPageHeight(Math.max(calculatedHeight, 400));
      setIsInitialized(true);
      initRef.current = true;
    };

    const timeoutId = requestAnimationFrame(calculateInitialPageHeight);
    return () => cancelAnimationFrame(timeoutId);
  }, [blocks.length, headerHeight, footerHeight, paginationControlsHeight]);

  const pageHeight = initialPageHeight || 600;

  const pages = useMemo(() => {
    if (blocks.length === 0 || !isInitialized) {
      return [{
        pageNumber: 1,
        blocks: [],
        startBlockIndex: 0,
        endBlockIndex: 0,
      }];
    }

    const ESTIMATED_HEADING_HEIGHT = 60;
    const ESTIMATED_PARAGRAPH_HEIGHT = 120;
    const ESTIMATED_IMAGE_HEIGHT = 300;
    const ESTIMATED_TABLE_HEIGHT = 200;

    const getEstimatedBlockHeight = (block: PaginatedBlock): number => {
      const contentLength = typeof block.content?.content === 'string' 
        ? block.content.content.length 
        : (typeof block.content === 'string' ? block.content.length : 100);

      switch (block.type) {
        case 'heading':
          return ESTIMATED_HEADING_HEIGHT;
        case 'image':
        case 'figure':
          return ESTIMATED_IMAGE_HEIGHT;
        case 'table':
          return ESTIMATED_TABLE_HEIGHT;
        case 'paragraph':
        default:
          const baseHeight = ESTIMATED_PARAGRAPH_HEIGHT;
          const additionalLines = Math.floor(contentLength / 80);
          return baseHeight + (additionalLines * 28);
      }
    };

    const paginatedPages: PageInfo[] = [];
    let currentPageBlocks: PaginatedBlock[] = [];
    let currentHeight = 0;
    let startBlockIndex = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const blockHeight = getEstimatedBlockHeight(block) + blockGap;

      const isHeadingFollowedByParagraph = 
        block.type === 'heading' && 
        i + 1 < blocks.length && 
        blocks[i + 1].type === 'paragraph';

      if (isHeadingFollowedByParagraph) {
        const nextBlockHeight = getEstimatedBlockHeight(blocks[i + 1]) + blockGap;
        const combinedHeight = blockHeight + nextBlockHeight;

        if (currentHeight + combinedHeight > pageHeight && currentPageBlocks.length > 0) {
          paginatedPages.push({
            pageNumber: paginatedPages.length + 1,
            blocks: [...currentPageBlocks],
            startBlockIndex,
            endBlockIndex: i - 1,
          });
          currentPageBlocks = [];
          currentHeight = 0;
          startBlockIndex = i;
        }

        currentPageBlocks.push(block);
        currentPageBlocks.push(blocks[i + 1]);
        currentHeight += combinedHeight;
        i++;
        continue;
      }

      if (currentHeight + blockHeight > pageHeight && currentPageBlocks.length > 0) {
        paginatedPages.push({
          pageNumber: paginatedPages.length + 1,
          blocks: [...currentPageBlocks],
          startBlockIndex,
          endBlockIndex: i - 1,
        });
        currentPageBlocks = [];
        currentHeight = 0;
        startBlockIndex = i;
      }

      currentPageBlocks.push(block);
      currentHeight += blockHeight;
    }

    if (currentPageBlocks.length > 0) {
      paginatedPages.push({
        pageNumber: paginatedPages.length + 1,
        blocks: currentPageBlocks,
        startBlockIndex,
        endBlockIndex: blocks.length - 1,
      });
    }

    console.log('[PAGINATION] Pages created:', {
      totalBlocks: blocks.length,
      totalPages: paginatedPages.length,
      pageHeight,
      pagesPreview: paginatedPages.map(p => ({
        page: p.pageNumber,
        blockCount: p.blocks.length,
        blockTypes: p.blocks.map(b => b.type),
      })),
    });

    return paginatedPages.length > 0 ? paginatedPages : [{
      pageNumber: 1,
      blocks: [],
      startBlockIndex: 0,
      endBlockIndex: 0,
    }];
  }, [blocks, pageHeight, blockGap, isInitialized]);

  const totalPages = pages.length;

  const currentPageBlocks = useMemo(() => {
    const pageIndex = Math.max(0, Math.min(currentPage - 1, pages.length - 1));
    return pages[pageIndex]?.blocks || [];
  }, [pages, currentPage]);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const goToNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  }, [currentPage, totalPages]);

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  }, [currentPage]);

  const goToPage = useCallback((page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(validPage);
  }, [totalPages]);

  return {
    pages,
    currentPageBlocks,
    currentPage,
    totalPages,
    pageHeight,
    setCurrentPage,
    goToNextPage,
    goToPreviousPage,
    goToPage,
    isInitialized,
  };
}

export default useBlockPagination;
