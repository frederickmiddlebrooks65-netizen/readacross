import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Search, FileText, Filter, SortAsc, Play, X, CheckSquare, Square, Check, ChevronsUpDown } from "lucide-react";
import { SentenceWithUserData } from "@/lib/types.d";

interface SentenceCardData extends SentenceWithUserData {
  document?: {
    title: string;
  };
  isRecommended?: boolean;
  scoreHistory?: number | null;
  isCompleted?: boolean;
  lastPracticeScore?: number;
}

interface SentenceListProps {
  sentences: SentenceCardData[];
  selectedSentences: Set<number>;
  onSelectionChange: (selectedIds: Set<number>) => void;
  onStartPractice: (sentences: SentenceCardData[]) => void;
}

export function SentenceList({ 
  sentences, 
  selectedSentences, 
  onSelectionChange, 
  onStartPractice 
}: SentenceListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "score" | "alphabetical" | "difficulty">("recent");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "practicing" | "completed" | "favorites">("all");
  const [selectedDocument, setSelectedDocument] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [documentSelectorOpen, setDocumentSelectorOpen] = useState(false);
  
  const itemsPerPage = 12;

  // Get unique documents
  const availableDocuments = useMemo(() => {
    const docs = sentences
      .filter(s => s.document?.title)
      .map(s => s.document!.title)
      .filter((title, index, arr) => arr.indexOf(title) === index);
    return docs;
  }, [sentences]);

  // Filter and sort sentences
  const filteredAndSortedSentences = useMemo(() => {
    let filtered = [...sentences];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(sentence =>
        sentence.source.toLowerCase().includes(query) ||
        sentence.userTranslation?.toLowerCase().includes(query) ||
        (sentence as any).noteContent?.toLowerCase().includes(query)
      );
    }

    // Document filter
    if (selectedDocument !== "all") {
      filtered = filtered.filter(sentence => 
        sentence.document?.title === selectedDocument
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(sentence => {
        switch (statusFilter) {
          case "new":
            return !sentence.practiced;
          case "practicing":
            return sentence.practiced && sentence.status !== "mastered";
          case "completed":
            return sentence.status === "completed";
          case "favorites":
            return sentence.isFavorite;
          default:
            return true;
        }
      });
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "recent":
          return new Date(b.lastPracticedAt || 0).getTime() - new Date(a.lastPracticedAt || 0).getTime();
        case "score":
          return (b.lastPracticeScore || 0) - (a.lastPracticeScore || 0);
        case "alphabetical":
          return a.source.localeCompare(b.source);
        case "difficulty":
          return (a.lastPracticeScore || 0) - (b.lastPracticeScore || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [sentences, searchQuery, selectedDocument, statusFilter, sortBy]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedSentences.length / itemsPerPage);
  const paginatedSentences = filteredAndSortedSentences.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSelectAll = () => {
    if (selectedSentences.size === paginatedSentences.length) {
      // Deselect all current page
      const newSelection = new Set(selectedSentences);
      paginatedSentences.forEach(s => newSelection.delete(s.id));
      onSelectionChange(newSelection);
    } else {
      // Select all current page
      const newSelection = new Set(selectedSentences);
      paginatedSentences.forEach(s => newSelection.add(s.id));
      onSelectionChange(newSelection);
    }
  };

  const handleSentenceToggle = (sentenceId: number) => {
    const newSelection = new Set(selectedSentences);
    if (newSelection.has(sentenceId)) {
      newSelection.delete(sentenceId);
    } else {
      newSelection.add(sentenceId);
    }
    onSelectionChange(newSelection);
  };

  const handleStartPractice = () => {
    const selectedSentenceData = sentences.filter(s => selectedSentences.has(s.id));
    onStartPractice(selectedSentenceData);
  };

  const getStatusBadge = (sentence: SentenceCardData) => {
    if (!sentence.practiced) return <Badge variant="secondary">새로운 문장</Badge>;
    if (sentence.status === "mastered") return <Badge variant="default">완료</Badge>;
    if (sentence.practiced) return <Badge variant="outline">연습 중</Badge>;
    return null;
  };

  const getScoreBadge = (sentence: SentenceCardData) => {
    if (sentence.lastPracticeScore == null) return null;
    const score = sentence.lastPracticeScore;
    const variant = score >= 8 ? "default" : score >= 6 ? "secondary" : "destructive";
    return <Badge variant={variant}>{score}/10</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Fixed Selection Bar */}
      {selectedSentences.size > 0 && (
        <div className="sticky top-0 z-10 bg-background border rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-sm font-medium">
                {selectedSentences.size}개 문장 선택됨
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSelectionChange(new Set())}
              >
                <X className="w-4 h-4 mr-2" />
                선택 해제
              </Button>
            </div>
            <Button 
              onClick={handleStartPractice}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Play className="w-4 h-4 mr-2" />
              연습 시작하기 ({selectedSentences.size}개)
            </Button>
          </div>
        </div>
      )}

      {/* Filter and Sort Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="문장 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Popover open={documentSelectorOpen} onOpenChange={setDocumentSelectorOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={documentSelectorOpen}
              className="w-full justify-between"
            >
              <div className="flex items-center">
                <FileText className="w-4 h-4 mr-2" />
                {selectedDocument === "all" 
                  ? "모든 문서" 
                  : availableDocuments.find((doc) => doc === selectedDocument) || "문서 선택"
                }
              </div>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder="문서 검색..." />
              <CommandList>
                <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      setSelectedDocument("all");
                      setDocumentSelectorOpen(false);
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        selectedDocument === "all" ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    모든 문서
                  </CommandItem>
                  {availableDocuments.map((doc) => (
                    <CommandItem
                      key={doc}
                      value={doc}
                      onSelect={(currentValue) => {
                        setSelectedDocument(currentValue === selectedDocument ? "all" : currentValue);
                        setDocumentSelectorOpen(false);
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          selectedDocument === doc ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {doc}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
          <SelectTrigger>
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="상태 필터" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">모든 상태</SelectItem>
            <SelectItem value="new">새로운 문장</SelectItem>
            <SelectItem value="practicing">연습 중</SelectItem>
            <SelectItem value="completed">완료</SelectItem>
            <SelectItem value="favorites">즐겨찾기</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
          <SelectTrigger>
            <SortAsc className="w-4 h-4 mr-2" />
            <SelectValue placeholder="정렬" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">최근 연습순</SelectItem>
            <SelectItem value="score">점수순</SelectItem>
            <SelectItem value="alphabetical">알파벳순</SelectItem>
            <SelectItem value="difficulty">난이도순</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Select All Controls */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSelectAll}
          className="flex items-center gap-2"
        >
          {selectedSentences.size === paginatedSentences.length ? (
            <CheckSquare className="w-4 h-4" />
          ) : (
            <Square className="w-4 h-4" />
          )}
          현재 페이지 모두 선택
        </Button>
        
        <div className="text-sm text-muted-foreground">
          총 {filteredAndSortedSentences.length}개 문장
        </div>
      </div>

      {/* Sentence Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {paginatedSentences.map((sentence) => (
          <Card 
            key={sentence.id} 
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedSentences.has(sentence.id) 
                ? 'ring-2 ring-blue-500 bg-blue-50' 
                : ''
            }`}
            onClick={() => handleSentenceToggle(sentence.id)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <Checkbox
                  checked={selectedSentences.has(sentence.id)}
                  onChange={() => handleSentenceToggle(sentence.id)}
                  className="mt-1"
                />
                <div className="flex gap-1">
                  {getStatusBadge(sentence)}
                  {getScoreBadge(sentence)}
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="pt-0">
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-900">
                  {sentence.source}
                </div>
                
                {sentence.userTranslation && (
                  <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    {sentence.userTranslation}
                  </div>
                )}
                
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{sentence.document?.title || "기타"}</span>
                  <span>
                    연습: {sentence.practiceCount || 0}회
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {paginatedSentences.length === 0 && (
        <div className="text-center py-12">
          <div className="text-muted-foreground">
            조건에 맞는 문장이 없습니다.
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
          >
            이전
          </Button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? "default" : "outline"}
                size="sm"
                onClick={() => setCurrentPage(page)}
                className="w-8 h-8 p-0"
              >
                {page}
              </Button>
            ))}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  );
}