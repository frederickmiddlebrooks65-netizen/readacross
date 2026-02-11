import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronLeft, ChevronRight, Search, SortAsc, FileText, FolderOpen, Play, User } from "lucide-react";
import { SentenceCard } from "./SentenceCard";
import { Sentence } from "@/../../shared/schema";

interface SentenceCardData extends Sentence {
  document?: {
    title: string;
  };
  isRecommended?: boolean;
  scoreHistory?: number | null;
  isCompleted?: boolean;
  lastPracticeScore?: number;
}

interface SentenceSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sentences: SentenceCardData[];
  onSentenceSelect: (sentence: SentenceCardData) => void;
  onSessionStart?: (sentences: SentenceCardData[]) => void;
}

export function SentenceSelectionModal({
  open,
  onOpenChange,
  sentences,
  onSentenceSelect,
  onSessionStart
}: SentenceSelectionModalProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "recommended" | "score" | "recent">("default");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "practicing" | "completed">("all");
  const [selectedDocument, setSelectedDocument] = useState<string>("all");

  const [selectedSentences, setSelectedSentences] = useState<Set<number>>(new Set());
  
  const itemsPerPage = 6; // 2열 x 3행

  // 문서별로 문장들을 그룹화
  const documentGroups = useMemo(() => {
    if (!Array.isArray(sentences)) return {};
    
    const groups: { [key: string]: SentenceCardData[] } = {};
    
    sentences.forEach(sentence => {
      const docTitle = sentence.document?.title || "기타 문장";
      if (!groups[docTitle]) {
        groups[docTitle] = [];
      }
      groups[docTitle].push(sentence);
    });
    
    return groups;
  }, [sentences]);

  const documentTitles = Object.keys(documentGroups);
  const totalDocuments = documentTitles.length;

  // 필터링 및 정렬 로직
  const filteredAndSortedSentences = useMemo(() => {
    let filtered = [...sentences];

    // 문서 필터
    if (selectedDocument !== "all") {
      filtered = filtered.filter(sentence => 
        sentence.document?.title === selectedDocument
      );
    }

    // 검색 필터
    if (searchQuery.trim()) {
      filtered = filtered.filter(sentence => 
        sentence.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sentence.document?.title?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // 상태 필터
    if (statusFilter !== "all") {
      filtered = filtered.filter(sentence => sentence.status === statusFilter);
    }

    // 정렬
    switch (sortBy) {
      case "recommended":
        filtered.sort((a, b) => {
          if (a.isRecommended && !b.isRecommended) return -1;
          if (!a.isRecommended && b.isRecommended) return 1;
          return 0;
        });
        break;
      case "score":
        filtered.sort((a, b) => {
          const scoreA = a.lastPracticeScore || 0;
          const scoreB = b.lastPracticeScore || 0;
          return scoreA - scoreB; // 낮은 점수부터
        });
        break;
      case "recent":
        filtered.sort((a, b) => {
          const dateA = a.lastPracticedAt ? new Date(a.lastPracticedAt).getTime() : 0;
          const dateB = b.lastPracticedAt ? new Date(b.lastPracticedAt).getTime() : 0;
          return dateB - dateA; // 최근 연습부터
        });
        break;
      default:
        // 기본 정렬 유지
        break;
    }

    return filtered;
  }, [sentences, searchQuery, sortBy, statusFilter, selectedDocument]);

  const totalPages = Math.ceil(filteredAndSortedSentences.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentSentences = filteredAndSortedSentences.slice(startIndex, startIndex + itemsPerPage);

  // 페이지 변경 시 검색 결과에 맞게 페이지 조정
  const totalItems = filteredAndSortedSentences.length;

  const handleSentenceClick = (sentence: SentenceCardData) => {
    // Always use session mode - toggle selection
    const newSelection = new Set(selectedSentences);
    if (newSelection.has(sentence.id)) {
      newSelection.delete(sentence.id);
    } else {
      newSelection.add(sentence.id);
    }
    setSelectedSentences(newSelection);
  };

  const handleSentenceSelection = (sentenceId: number, isSelected: boolean) => {
    const newSelection = new Set(selectedSentences);
    if (isSelected) {
      newSelection.add(sentenceId);
    } else {
      newSelection.delete(sentenceId);
    }
    setSelectedSentences(newSelection);
  };

  const handleSelectAll = () => {
    const newSelection = new Set(currentSentences.map(s => s.id));
    setSelectedSentences(newSelection);
  };

  const handleClearSelection = () => {
    setSelectedSentences(new Set());
  };

  const handleStartSession = () => {
    if (selectedSentences.size === 0) return;
    const selectedSentenceObjects = sentences.filter(s => selectedSentences.has(s.id));
    onSessionStart?.(selectedSentenceObjects);
    onOpenChange(false);
    setSelectedSentences(new Set());
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const handleResetFilters = () => {
    setSelectedDocument("all");
    setStatusFilter("all");
    setSortBy("default");
    setSearchQuery("");
    setCurrentPage(1);
    setSelectedSentences(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            연습할 문장 선택
          </DialogTitle>
          <DialogDescription>
            여러 문장을 선택하여 연속으로 연습할 수 있습니다. 체크박스로 문장을 선택하고 연습을 시작하세요.
          </DialogDescription>
        </DialogHeader>

        {/* Selection Controls */}
        <div className="bg-muted p-4 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm">문장 선택</h3>
            {selectedSentences.size > 0 && (
              <Badge variant="secondary">
                {selectedSentences.size}개 문장 선택됨
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSelectAll}
              disabled={currentSentences.length === 0}
            >
              현재 페이지 모두 선택
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClearSelection}
              disabled={selectedSentences.size === 0}
            >
              선택 해제
            </Button>
            <Button
              size="sm"
              onClick={handleStartSession}
              disabled={selectedSentences.size === 0}
              className="ml-auto bg-blue-600 hover:bg-blue-700"
            >
              <Play className="h-4 w-4 mr-2" />
              연습 시작하기 ({selectedSentences.size}개)
            </Button>
          </div>
        </div>

        {/* 필터 및 검색 영역 */}
        <div className="space-y-4">
          {/* 검색바 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="문장 내용이나 문서 제목으로 검색..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1); // 검색 시 첫 페이지로 이동
              }}
              className="pl-10"
            />
          </div>

          {/* 필터 및 정렬 */}
          <div className="flex items-center gap-4 flex-wrap">
            <Select value={selectedDocument} onValueChange={(value: string) => {
              setSelectedDocument(value);
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-[180px]">
                <FolderOpen className="h-4 w-4 mr-2" />
                <SelectValue placeholder="문서 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 문서</SelectItem>
                {documentTitles.map(title => (
                  <SelectItem key={title} value={title}>
                    {title} ({documentGroups[title].length}개)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(value: any) => {
              setStatusFilter(value);
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="상태 필터" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="new">새로운 문장</SelectItem>
                <SelectItem value="practicing">연습 중</SelectItem>
                <SelectItem value="completed">완료</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(value: any) => {
              setSortBy(value);
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-[140px]">
                <SortAsc className="h-4 w-4 mr-2" />
                <SelectValue placeholder="정렬" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">기본 순서</SelectItem>
                <SelectItem value="recommended">추천 순</SelectItem>
                <SelectItem value="score">점수 낮은 순</SelectItem>
                <SelectItem value="recent">최근 연습 순</SelectItem>
              </SelectContent>
            </Select>

            <div className="ml-auto flex items-center gap-2">
              {(selectedDocument !== "all" || statusFilter !== "all" || sortBy !== "default" || searchQuery.trim()) && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleResetFilters}
                  className="text-xs"
                >
                  필터 초기화
                </Button>
              )}
              <Badge variant="outline">
                총 {totalItems}개 문장
              </Badge>
              {selectedDocument !== "all" && (
                <Badge variant="secondary">
                  {selectedDocument}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* 문장 카드 그리드 */}
        <div className="mt-6">
          {currentSentences.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentSentences.map((sentence) => (
                <div key={sentence.id} className="relative">
                  <div className="absolute top-2 right-2 z-10">
                    <Checkbox
                      checked={selectedSentences.has(sentence.id)}
                      onCheckedChange={(checked) => handleSentenceSelection(sentence.id, !!checked)}
                      className="bg-white/90 border-2 shadow-md"
                    />
                  </div>
                  <div className={`transition-all ${
                      selectedSentences.has(sentence.id) 
                        ? "ring-2 ring-blue-500 bg-blue-50 rounded-lg" 
                        : "hover:ring-1 hover:ring-gray-300 rounded-lg"
                    }`}>
                    <SentenceCard
                      sentence={sentence}
                      onClick={() => handleSentenceClick(sentence)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">검색 결과가 없습니다</p>
              <p className="text-sm mt-2">다른 검색어나 필터를 시도해보세요</p>
            </div>
          )}
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <div className="text-sm text-gray-600">
              {totalItems > 0 && (
                <>
                  {startIndex + 1}-{Math.min(startIndex + itemsPerPage, totalItems)}개 (총 {totalItems}개)
                </>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                이전
              </Button>
              
              {/* 페이지 번호 */}
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const pageNum = i + 1;
                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePageChange(pageNum)}
                      className="w-8 h-8 p-0"
                    >
                      {pageNum}
                    </Button>
                  );
                })}
                {totalPages > 5 && (
                  <>
                    {totalPages > 6 && <span className="text-gray-400">...</span>}
                    <Button
                      variant={currentPage === totalPages ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePageChange(totalPages)}
                      className="w-8 h-8 p-0"
                    >
                      {totalPages}
                    </Button>
                  </>
                )}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                다음
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}