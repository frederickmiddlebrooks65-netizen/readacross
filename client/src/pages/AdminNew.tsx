import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import PageHeader from "@/components/layout/PageHeader";
import PageBody from "@/components/layout/PageBody";
import HeaderBar from "@/components/layout/HeaderBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  Server, Database, FileX, FileText, BarChart3, Eye, Calendar, Clock, 
  RefreshCw, Settings, Zap, Play, Square, Rss, Cog, PlayCircle,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, Trash2, Search, Filter,
  AlertTriangle, Activity, Timer, Users, Edit2
} from "lucide-react";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/dateUtils";
import { useTimezone } from "@/hooks/useTimezone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// Types based on instructions.md
interface AdminStats {
  totalDocuments: number;
  userDocuments: number;
  publicDocuments: number;
}

interface SystemStatus {
  system: {
    status: 'active' | 'inactive';
    lastExecution: string | null;
    nextExecution: string | null;
  };
  statistics: AdminStats;
  scheduler: {
    isRunning: boolean;
    lastRun: string | null;
    nextRun: string | null;
    jobs: Array<{
      name: string;
      running: boolean;
      status: string;
    }>;
  };
}

interface ExecutionLog {
  id: string;
  timestamp: string;
  sourceType: 'rss' | 'system';
  target: string;
  processed: number;
  result: 'success' | 'failure';
  details?: string;
}

interface RssFeed {
  id: number;
  canonicalUrl: string;
  title: string;
  category: string;
  healthScore: number;
  isBlocked: boolean;
  isSystemSource: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  errorCount: number;
  lastError: string | null;
  createdAt: string;
}

interface RssPolicy {
  id: number;
  maxFeedsPerUser: number;
  minSyncInterval: number;
  maxSyncInterval: number;
  dailyFetchLimit: number;
  allowedDomains: string[] | null;
  blockedDomains: string[] | null;
  requireApproval: boolean;
  arxivEnabled: boolean;
  gutenbergEnabled: boolean;
}

// Document interface for management
interface Document {
  id: number;
  title: string;
  author: string;
  category: string;
  isPublic: boolean;
  createdAt: string;
  source?: string | null;
  sourceDomain?: string | null;
  isPermanent?: boolean;
  expiresAt?: string | null;
}

// Sync Log interface
interface SyncLog {
  id: number;
  sourceType: string;
  sourceName: string;
  action: string;
  status: 'success' | 'failure' | 'pending';
  itemsProcessed: number;
  itemsAdded: number;
  itemsFailed: number;
  errorMessage?: string | null;
  executedAt: string;
  durationMs?: number | null;
}

interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  status: string;
  plan: string;
  planType: string | null;
  planExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  oauthProvider: string | null;
  documentsUploaded: number;
}

interface AdminUsersResponse {
  users: AdminUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Main AdminNew Component
export function AdminNew() {
  const [selectedRssFeeds, setSelectedRssFeeds] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Data fetching
  // 관리자 통계 조회 API (실제 백엔드 엔드포인트)
  const { data: adminStats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    refetchInterval: 30000,
  });

  // 스케줄러 상태 조회 API
  const { data: schedulerStatus } = useQuery({
    queryKey: ["/api/admin/scheduler/status"],
    refetchInterval: 30000,
  });

  const { data: executionLogs } = useQuery<ExecutionLog[]>({
    queryKey: ["/api/admin/execution-logs"],
    refetchInterval: 30000,
  });

  const { data: feedsData } = useQuery<RssFeed[]>({
    queryKey: ["/api/admin/feeds"],
    refetchInterval: 60000,
  });

  const { data: rssPolicy } = useQuery<RssPolicy>({
    queryKey: ["/api/admin/rss-policy"],
  });

  const { data: expiredDocuments } = useQuery<any[]>({
    queryKey: ["/api/admin/documents/expired"],
  });

  // Mutations
  const triggerSyncMutation = useMutation({
    mutationFn: async (type: 'all' | 'rss' | 'system' | 'restart' | 'stop') => {
      if (type === 'restart') {
        return await apiRequest("/api/admin/scheduler/restart", { method: "POST" });
      } else if (type === 'stop') {
        return await apiRequest("/api/admin/scheduler/stop", { method: "POST" });
      } else {
        return await apiRequest("/api/admin/scheduler/trigger-sync", {
          method: "POST",
          body: JSON.stringify({ type }),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduler/status"] });
      toast({ title: "동기화가 시작되었습니다" });
    },
    onError: () => {
      toast({ title: "오류", description: "동기화 요청에 실패했습니다", variant: "destructive" });
    },
  });

  const updateRssPolicyMutation = useMutation({
    mutationFn: async (updates: Partial<RssPolicy>) => {
      return await apiRequest("/api/admin/rss-policy", {
        method: "PATCH",
        json: updates,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rss-policy"] });
      toast({ title: "RSS 정책이 업데이트되었습니다" });
    },
    onError: () => {
      toast({ title: "오류", description: "정책 업데이트에 실패했습니다", variant: "destructive" });
    },
  });

  const syncFeedsMutation = useMutation({
    mutationFn: async (feedIds: number[]) => {
      return await apiRequest("/api/admin/sync/feeds", {
        method: "POST",
        body: JSON.stringify({ feedIds }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/execution-logs"] });
      toast({ title: "피드 동기화가 시작되었습니다" });
    },
    onError: () => {
      toast({ title: "오류", description: "동기화 요청에 실패했습니다", variant: "destructive" });
    },
  });

  return (
    <Layout>
      <PageShell maxWidth="standard">
        <HeaderBar
          title="관리자 대시보드"
          subtitle="시스템 상태 모니터링 및 운영 제어"
        />
        <PageBody className="space-y-8">

        {/* 1. 시스템 현황 섹션 */}
        <SystemOverview
          adminStats={adminStats}
          schedulerStatus={schedulerStatus}
          expiredCount={expiredDocuments?.length || 0}
        />

        {/* 2. 소스 관리 (2열 레이아웃) - instructions.md */}
        <SourceManagement
          adminStats={adminStats}
          schedulerStatus={schedulerStatus}
          rssPolicy={rssPolicy}
          feedsData={feedsData}
          selectedRssFeeds={selectedRssFeeds}
          setSelectedRssFeeds={setSelectedRssFeeds}
          triggerSyncMutation={triggerSyncMutation}
          updateRssPolicyMutation={updateRssPolicyMutation}
          syncFeedsMutation={syncFeedsMutation}
        />

        {/* 3. 문서 관리 섹션 */}
        <DocumentManagement expiredDocuments={expiredDocuments} />

        {/* 5. 사용자 관리 섹션 */}
        <UserManagement />

        {/* 4. 동기화 로그 섹션 */}
        <SyncLogsSection />
        </PageBody>
      </PageShell>
    </Layout>
  );
}

// 1. System Overview Section - instructions.md 계획에 따른 상단 현황 대시보드
interface SystemOverviewProps {
  adminStats?: AdminStats;
  schedulerStatus?: any;
  expiredCount: number;
}

function SystemOverview({ adminStats, schedulerStatus, expiredCount }: SystemOverviewProps) {
  const { timezone, language } = useTimezone();
  const { data: feedsData } = useQuery<RssFeed[]>({
    queryKey: ["/api/admin/feeds"],
    refetchInterval: 60000,
  });

  // 현황 대시보드 데이터 계산
  const totalRssFeeds = feedsData?.length || 0;
  const systemSourcesCount = 2; // arXiv, Project Gutenberg (instructions.md에 명시)
  const totalSources = totalRssFeeds + systemSourcesCount;
  
  // 최근 24시간 동기화 성공률 계산 (단순화 버전)
  const errorFeedsCount = feedsData?.filter(f => f.errorCount > 0).length || 0;
  const successRate = totalRssFeeds > 0 
    ? Math.round(((totalRssFeeds - errorFeedsCount) / totalRssFeeds) * 100)
    : 100;
    
  const formatAdminDateTime = (dateString: string | null | undefined) => {
    if (!dateString) return '없음';
    return formatDateTime(dateString, { timezone, language });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-6 w-6 text-brand" />
        <h2 className="text-2xl font-bold text-gray-900">현황 대시보드</h2>
        <span className="text-sm text-gray-500">전체 소스 수, 동기화 성공률, 최근 실행 시간 요약</span>
      </div>

      {/* instructions.md: 작은 카드 UI로 요약 표시 */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* 전체 소스 수 */}
        <Card className="border-l-4 border-l-brand hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-brand">전체 소스</CardTitle>
            <Server className="h-4 w-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">{totalSources}</div>
            <p className="text-xs text-muted-foreground mt-1">시스템 + 사용자 소스</p>
          </CardContent>
        </Card>

        {/* 시스템 소스 수 */}
        <Card className="border-l-4 border-l-brand hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-brand">시스템 소스</CardTitle>
            <Database className="h-4 w-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">{systemSourcesCount}</div>
            <p className="text-xs text-muted-foreground mt-1">arXiv, Gutenberg</p>
          </CardContent>
        </Card>

        {/* 사용자 소스 수 (RSS) */}
        <Card className="border-l-4 border-l-brand hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-brand">사용자 소스</CardTitle>
            <Rss className="h-4 w-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">{totalRssFeeds}</div>
            <p className="text-xs text-muted-foreground mt-1">RSS 피드</p>
          </CardContent>
        </Card>

        {/* 최근 24시간 동기화 성공률 */}
        <Card className="border-l-4 border-l-green-500 hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-700">동기화 성공률</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${
              successRate >= 90 ? 'text-green-600' : 
              successRate >= 70 ? 'text-yellow-600' : 'text-red-600'
            }`}>{successRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">최근 24시간</p>
          </CardContent>
        </Card>

        {/* 최근 실행 시간 */}
        <Card className="border-l-4 border-l-gray-500 hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700">최근 실행</CardTitle>
            <Clock className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold text-gray-900">
              {formatAdminDateTime(schedulerStatus?.lastRun)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">마지막 동기화</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// System Status Indicator Component
function SystemStatusIndicator({ schedulerStatus }: { schedulerStatus?: any }) {
  if (!schedulerStatus) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            <span>시스템 상태 로딩 중...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null; // 중복 정보로 삭제됨
}

// Document Count Cards Component
interface DocumentCountCardsProps {
  stats?: AdminStats;
  expiredCount: number;
}

function DocumentCountCards({ stats, expiredCount }: DocumentCountCardsProps) {
  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-l-4 border-l-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-center">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="border-l-4 border-l-brand hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-brand">전체 문서</CardTitle>
          <BarChart3 className="h-4 w-4 text-brand" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-brand">{stats.totalDocuments.toLocaleString()}</div>
          <p className="text-xs text-brand mt-1">시스템 내 모든 문서</p>
          <Progress value={100} className="mt-2 h-1" />
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-brand hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-brand">사용자 문서</CardTitle>
          <Database className="h-4 w-4 text-brand" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-brand">{stats.userDocuments.toLocaleString()}</div>
          <p className="text-xs text-brand mt-1">업로드된 개인 문서</p>
          <Progress 
            value={stats.totalDocuments > 0 ? (stats.userDocuments / stats.totalDocuments) * 100 : 0} 
            className="mt-2 h-1" 
          />
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-brand hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-brand">공개 문서</CardTitle>
          <Eye className="h-4 w-4 text-brand" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-brand">{stats.publicDocuments.toLocaleString()}</div>
          <p className="text-xs text-brand mt-1">Explore 탭 콘텐츠</p>
          <Progress 
            value={stats.totalDocuments > 0 ? (stats.publicDocuments / stats.totalDocuments) * 100 : 0} 
            className="mt-2 h-1" 
          />
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-destructive hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-destructive">만료 문서</CardTitle>
          <FileX className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-destructive">{expiredCount.toLocaleString()}</div>
          <p className="text-xs text-destructive mt-1">정리 대상 문서</p>
          <Progress 
            value={stats.totalDocuments > 0 ? (expiredCount / stats.totalDocuments) * 100 : 0} 
            className="mt-2 h-1" 
          />
        </CardContent>
      </Card>
    </div>
  );
}


// 2. Source Management Section (2열 레이아웃) - instructions.md 계획에 따른 구조 개선
interface SourceManagementProps {
  adminStats?: AdminStats;
  schedulerStatus?: any;
  rssPolicy?: RssPolicy;
  feedsData?: RssFeed[];
  selectedRssFeeds: Set<number>;
  setSelectedRssFeeds: (feeds: Set<number>) => void;
  triggerSyncMutation: any;
  updateRssPolicyMutation: any;
  syncFeedsMutation: any;
}

function SourceManagement({ 
  adminStats, 
  schedulerStatus,
  rssPolicy, 
  feedsData, 
  selectedRssFeeds,
  setSelectedRssFeeds,
  triggerSyncMutation, 
  updateRssPolicyMutation, 
  syncFeedsMutation 
}: SourceManagementProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Database className="h-6 w-6 text-brand" />
        <h2 className="text-2xl font-bold text-gray-900">소스 관리</h2>
        <span className="text-sm text-gray-500">시스템 소스 및 사용자 소스 관리</span>
      </div>


      {/* 2열 레이아웃: 시스템 소스 + 사용자 소스 관리 */}
      <DocumentSourceManagement
        feedsData={feedsData}
        rssPolicy={rssPolicy}
        selectedRssFeeds={selectedRssFeeds}
        setSelectedRssFeeds={setSelectedRssFeeds}
        syncFeedsMutation={syncFeedsMutation}
        updateRssPolicyMutation={updateRssPolicyMutation}
        triggerSyncMutation={triggerSyncMutation}
      />

      {/* 섹션 푸터: 실행/스케줄 제어 - instructions.md */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">실행 제어</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => triggerSyncMutation.mutate('all')}
              disabled={triggerSyncMutation.isPending}
              className="text-xs h-8"
            >
              전체 동기화
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => triggerSyncMutation.mutate('system')}
              disabled={triggerSyncMutation.isPending}
              className="text-xs h-8"
            >
              시스템만
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => triggerSyncMutation.mutate('rss')}
              disabled={triggerSyncMutation.isPending}
              className="text-xs h-8"
            >
              사용자만
            </Button>
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-gray-300">
              <span className="text-xs text-gray-600">스케줄러</span>
              <Switch
                checked={schedulerStatus?.isRunning || false}
                onCheckedChange={(checked) => {
                  triggerSyncMutation.mutate(checked ? 'restart' : 'stop');
                }}
                disabled={triggerSyncMutation.isPending}
                className="data-[state=checked]:bg-brand"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// 2.2 문서 소스 관리 (시스템 소스 + RSS 소스 통합) 
interface DocumentSourceManagementProps {
  feedsData?: RssFeed[];
  rssPolicy?: RssPolicy;
  selectedRssFeeds: Set<number>;
  setSelectedRssFeeds: (feeds: Set<number>) => void;
  syncFeedsMutation: any;
  updateRssPolicyMutation: any;
  triggerSyncMutation: any;
}

function DocumentSourceManagement({ 
  feedsData, 
  rssPolicy, 
  selectedRssFeeds,
  setSelectedRssFeeds,
  syncFeedsMutation,
  updateRssPolicyMutation,
  triggerSyncMutation
}: DocumentSourceManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const systemFeeds = useMemo(() => feedsData?.filter(f => f.isSystemSource) || [], [feedsData]);
  const userFeeds = useMemo(() => feedsData?.filter(f => !f.isSystemSource) || [], [feedsData]);

  const toggleSystemSourceMutation = useMutation({
    mutationFn: async ({ feedId, isBlocked }: { feedId: number; isBlocked: boolean }) => {
      return await apiRequest(`/api/admin/feeds/${feedId}`, {
        method: "PATCH",
        json: { isBlocked },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feeds/health"] });
      toast({ title: "소스 상태가 변경되었습니다" });
    },
    onError: () => {
      toast({ title: "오류", description: "소스 상태 변경에 실패했습니다", variant: "destructive" });
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 시스템 소스 카드 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            시스템 소스
          </CardTitle>
          <CardDescription>
            내장 소스 관리 — 토글로 활성/비활성 제어
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
              rssPolicy?.arxivEnabled !== false ? "bg-brand-subtle border-brand" : "bg-muted/50 border-border"
            }`}>
              <div className="flex items-center gap-2">
                <Cog className={`h-4 w-4 ${rssPolicy?.arxivEnabled !== false ? "text-brand" : "text-muted-foreground"}`} />
                <div>
                  <p className={`font-medium ${rssPolicy?.arxivEnabled !== false ? "text-brand" : "text-muted-foreground"}`}>arXiv 학술 논문</p>
                  <p className={`text-xs ${rssPolicy?.arxivEnabled !== false ? "text-brand" : "text-muted-foreground"}`}>학술 논문 크롤러</p>
                </div>
              </div>
              <Switch
                checked={rssPolicy?.arxivEnabled !== false}
                onCheckedChange={(checked) => {
                  updateRssPolicyMutation.mutate({ arxivEnabled: checked });
                }}
                disabled={updateRssPolicyMutation.isPending}
              />
            </div>

            <div className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
              rssPolicy?.gutenbergEnabled !== false ? "bg-brand-subtle border-brand" : "bg-muted/50 border-border"
            }`}>
              <div className="flex items-center gap-2">
                <Cog className={`h-4 w-4 ${rssPolicy?.gutenbergEnabled !== false ? "text-brand" : "text-muted-foreground"}`} />
                <div>
                  <p className={`font-medium ${rssPolicy?.gutenbergEnabled !== false ? "text-brand" : "text-muted-foreground"}`}>Project Gutenberg</p>
                  <p className={`text-xs ${rssPolicy?.gutenbergEnabled !== false ? "text-brand" : "text-muted-foreground"}`}>고전 문학 크롤러</p>
                </div>
              </div>
              <Switch
                checked={rssPolicy?.gutenbergEnabled !== false}
                onCheckedChange={(checked) => {
                  updateRssPolicyMutation.mutate({ gutenbergEnabled: checked });
                }}
                disabled={updateRssPolicyMutation.isPending}
              />
            </div>

            {systemFeeds.map((feed) => (
              <div
                key={feed.id}
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  feed.isBlocked
                    ? "bg-muted/50 border-border"
                    : "bg-brand-subtle border-brand"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Cog className={`h-4 w-4 flex-shrink-0 ${feed.isBlocked ? "text-muted-foreground" : "text-brand"}`} />
                  <div className="min-w-0">
                    <p className={`font-medium truncate ${feed.isBlocked ? "text-muted-foreground" : "text-brand"}`}>
                      {feed.title}
                    </p>
                    <p className={`text-xs truncate ${feed.isBlocked ? "text-muted-foreground" : "text-brand"}`}>
                      {feed.category || '일반'}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={!feed.isBlocked}
                  onCheckedChange={(checked) => {
                    toggleSystemSourceMutation.mutate({ feedId: feed.id, isBlocked: !checked });
                  }}
                  disabled={toggleSystemSourceMutation.isPending}
                />
              </div>
            ))}
          </div>

          <div className="pt-3 border-t">
            <div className="text-sm text-muted-foreground">
              활성 {(rssPolicy?.arxivEnabled !== false ? 1 : 0) + (rssPolicy?.gutenbergEnabled !== false ? 1 : 0) + systemFeeds.filter(f => !f.isBlocked).length}개 / 전체 {2 + systemFeeds.length}개
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RSS 소스 카드 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rss className="h-5 w-5" />
            RSS 소스
          </CardTitle>
          <CardDescription>
            다중 사용자 RSS 피드 관리
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RSSSourceSection 
            feedsData={userFeeds}
            rssPolicy={rssPolicy}
            selectedRssFeeds={selectedRssFeeds}
            setSelectedRssFeeds={setSelectedRssFeeds}
            syncFeedsMutation={syncFeedsMutation}
            updateRssPolicyMutation={updateRssPolicyMutation}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// RSS Source Section Component (큰 카드/테이블 형태)
interface RSSSourceSectionProps {
  feedsData?: RssFeed[];
  rssPolicy?: RssPolicy;
  selectedRssFeeds: Set<number>;
  setSelectedRssFeeds: (feeds: Set<number>) => void;
  syncFeedsMutation: any;
  updateRssPolicyMutation: any;
}

function RSSSourceSection({ 
  feedsData, 
  rssPolicy, 
  selectedRssFeeds,
  setSelectedRssFeeds,
  syncFeedsMutation,
  updateRssPolicyMutation
}: RSSSourceSectionProps) {
  const [activeTab, setActiveTab] = useState<'feeds' | 'subscriptions' | 'policy'>('feeds');
  const [selectedFeedForDetail, setSelectedFeedForDetail] = useState<RssFeed | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 개별 피드 재시도
  const handleRetryFeed = (feedId: number) => {
    syncFeedsMutation.mutate([feedId]);
  };

  // 피드 편집
  const [editingFeed, setEditingFeed] = useState<RssFeed | null>(null);
  const [editForm, setEditForm] = useState({ title: '', url: '' });

  const editFeedMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: { title: string, url: string } }) => {
      return await apiRequest(`/api/admin/feeds/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feeds/health"] });
      setEditingFeed(null);
      toast({ title: "피드가 수정되었습니다" });
    },
    onError: () => {
      toast({ title: "오류", description: "피드 수정에 실패했습니다", variant: "destructive" });
    },
  });

  const handleEditFeed = (feed: RssFeed) => {
    setEditingFeed(feed);
    setEditForm({ title: feed.title, url: feed.canonicalUrl });
  };

  const handleSaveEdit = () => {
    if (!editingFeed) return;
    editFeedMutation.mutate({ 
      id: editingFeed.id, 
      data: editForm 
    });
  };

  // 피드 삭제
  const deleteFeedMutation = useMutation({
    mutationFn: async (feedId: number) => {
      return await apiRequest(`/api/admin/feeds/${feedId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feeds/health"] });
      toast({ title: "피드가 삭제되었습니다" });
    },
    onError: () => {
      toast({ title: "오류", description: "피드 삭제에 실패했습니다", variant: "destructive" });
    },
  });

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: 'deleteFeed';
    data: { feedId: number; feedTitle: string } | null;
  }>({ open: false, type: 'deleteFeed', data: null });

  const handleDeleteFeed = (feedId: number, feedTitle: string) => {
    setConfirmDialog({ open: true, type: 'deleteFeed', data: { feedId, feedTitle } });
  };

  const handleConfirmAction = () => {
    if (confirmDialog.type === 'deleteFeed' && confirmDialog.data) {
      deleteFeedMutation.mutate(confirmDialog.data.feedId);
    }
    setConfirmDialog({ open: false, type: 'deleteFeed', data: null });
  };

  const errorFeedsCount = feedsData?.filter(f => f.errorCount > 3).length || 0;

  // Subscription 데이터 조회
  const { data: subscriptionsData } = useQuery<any[]>({
    queryKey: ["/api/admin/subscriptions"],
    queryFn: async () => {
      const response = await fetch("/api/admin/subscriptions");
      if (!response.ok) throw new Error('Failed to fetch subscriptions');
      return response.json();
    },
    refetchInterval: 30000,
  });


  // 성공률 계산 (24시간 기준)
  const totalFeeds = feedsData?.length || 0;
  const successRate = totalFeeds > 0 
    ? Math.round(((totalFeeds - errorFeedsCount) / totalFeeds) * 100)
    : 100;

  // 요청량 사용률 계산 (가상의 일일 한도 대비)
  const dailyQuota = rssPolicy?.dailyFetchLimit || 1000;
  const usedRequests = feedsData?.reduce((sum, feed) => sum + (feed.errorCount || 0), 0) || 0;
  const quotaUsage = Math.min(Math.round((usedRequests / dailyQuota) * 100), 100);

  // 오래 업데이트 안 된 피드 계산 (7일 이상)
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const staleFeedsCount = feedsData?.filter(feed => {
    if (!feed.lastRunAt) return true; // 한 번도 실행되지 않은 피드
    return new Date(feed.lastRunAt).getTime() < sevenDaysAgo;
  }).length || 0;

  return (
    <>
      <div className="space-y-4">
        {/* 알림 시스템 */}
        {(errorFeedsCount > 0 || staleFeedsCount > 0) && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-medium text-yellow-800">운영 알림</h4>
                <div className="mt-2 space-y-1 text-sm text-yellow-700">
                  {errorFeedsCount > 0 && (
                    <p>• {errorFeedsCount}개 피드에서 3회 이상 연속 실패가 발생했습니다.</p>
                  )}
                  {staleFeedsCount > 0 && (
                    <p>• {staleFeedsCount}개 피드가 7일 이상 업데이트되지 않았습니다.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 핵심 대시보드 지표 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="text-2xl font-bold text-gray-900">{feedsData?.length || 0}</div>
            <div className="text-sm text-gray-600">총 피드 수</div>
          </div>
          <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className={`text-2xl font-bold ${successRate >= 80 ? 'text-green-600' : successRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
              {successRate}%
            </div>
            <div className="text-sm text-gray-600">24시간 성공률</div>
          </div>
          <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className={`text-2xl font-bold ${errorFeedsCount === 0 ? 'text-green-600' : errorFeedsCount <= 2 ? 'text-yellow-600' : 'text-red-600'}`}>
              {errorFeedsCount}
            </div>
            <div className="text-sm text-gray-600">문제 피드</div>
          </div>
          <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className={`text-2xl font-bold ${quotaUsage < 70 ? 'text-green-600' : quotaUsage < 90 ? 'text-yellow-600' : 'text-red-600'}`}>
              {quotaUsage}%
            </div>
            <div className="text-sm text-gray-600">일일 쿼터 사용률</div>
          </div>
        </div>

      {/* 탭 네비게이션 */}
      <div className="flex space-x-1 bg-muted p-1 rounded-lg">
        {[
          { key: 'feeds', label: '피드 관리', icon: Database },
          { key: 'subscriptions', label: '사용자 구독', icon: Users },
          { key: 'policy', label: '설정', icon: Settings }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as any)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="min-h-[300px]">
          {activeTab === 'feeds' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-medium">Feed 목록</h4>
                <div className="flex gap-2">
                  <Badge variant="secondary">
                    총 {feedsData?.length || 0}개
                  </Badge>
                  {(() => {
                    const pendingCount = feedsData?.filter(f => f.isBlocked && !f.isSystemSource).length || 0;
                    return pendingCount > 0 ? (
                      <Badge className="bg-orange-100 text-orange-700 border-orange-300">
                        승인 대기 {pendingCount}개
                      </Badge>
                    ) : null;
                  })()}
                  {errorFeedsCount > 0 && (
                    <Badge variant="destructive">
                      문제 {errorFeedsCount}개
                    </Badge>
                  )}
                </div>
              </div>

              {/* Feed 목록 - 단순화된 뷰 */}
              {feedsData && feedsData.length > 0 ? (
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {feedsData.map((feed) => {
                    const getStatus = () => {
                      if (feed.isBlocked && !feed.isSystemSource) return 'pending';
                      if (feed.isBlocked || feed.errorCount > 3) return 'failed';
                      if (feed.errorCount > 0) return 'warning';
                      return 'normal';
                    };
                    
                    const status = getStatus();
                    const statusConfig = {
                      normal: { color: 'text-green-600', bg: 'bg-green-50', label: '정상' },
                      warning: { color: 'text-yellow-600', bg: 'bg-yellow-50', label: '경고' },
                      failed: { color: 'text-red-600', bg: 'bg-red-50', label: '실패' },
                      pending: { color: 'text-orange-600', bg: 'bg-orange-50', label: '승인 대기' }
                    };

                    // 상대 시간 계산
                    const getRelativeTime = (dateString: string | null) => {
                      if (!dateString) return '없음';
                      const diff = Date.now() - new Date(dateString).getTime();
                      const hours = Math.floor(diff / (1000 * 60 * 60));
                      const days = Math.floor(hours / 24);
                      
                      if (days > 0) return `${days}일 전`;
                      if (hours > 0) return `${hours}시간 전`;
                      return '방금 전';
                    };

                    return (
                      <div key={feed.id} className={`p-3 rounded-lg border transition-colors ${
                        status === 'pending' 
                          ? 'bg-orange-50/50 border-orange-200 hover:border-orange-400' 
                          : 'bg-white hover:border-blue-300'
                      }`}>
                        <div className="flex items-center justify-between">
                          {/* 기본 정보 */}
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedRssFeeds.has(feed.id)}
                              onChange={(e) => {
                                const newSelected = new Set(selectedRssFeeds);
                                if (e.target.checked) {
                                  newSelected.add(feed.id);
                                } else {
                                  newSelected.delete(feed.id);
                                }
                                setSelectedRssFeeds(newSelected);
                              }}
                              className="rounded"
                              data-testid={`checkbox-feed-${feed.id}`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium truncate text-gray-900">{feed.title}</h4>
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusConfig[status].bg} ${statusConfig[status].color}`}>
                                  {statusConfig[status].label}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 truncate">{feed.canonicalUrl}</p>
                            </div>
                          </div>

                          {/* 우측 정보 및 액션 */}
                          <div className="flex items-center gap-4 ml-4">
                            <div className="text-right">
                              <div className="text-sm text-gray-600">
                                {getRelativeTime(feed.lastRunAt)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {feed.lastError ? '실패' : '성공'}
                              </div>
                            </div>
                            
                            {/* 액션 버튼들 */}
                            <div className="flex items-center gap-1">
                              {!feed.isSystemSource && (
                                <button
                                  className={`p-1 transition-colors disabled:opacity-50 ${
                                    feed.isBlocked
                                      ? 'text-orange-500 hover:text-green-600'
                                      : 'text-green-500 hover:text-red-600'
                                  }`}
                                  title={feed.isBlocked ? '승인 (크롤링 허용)' : '차단'}
                                  data-testid={`button-toggle-${feed.id}`}
                                  onClick={() => toggleSystemSourceMutation.mutate({ feedId: feed.id, isBlocked: !feed.isBlocked })}
                                  disabled={toggleSystemSourceMutation.isPending}
                                >
                                  {feed.isBlocked ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                </button>
                              )}
                              <button
                                className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                                title="상세 보기"
                                data-testid={`button-detail-${feed.id}`}
                                onClick={() => setSelectedFeedForDetail(feed)}
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              <button
                                className="p-1 text-gray-400 hover:text-green-600 transition-colors disabled:opacity-50"
                                title="재시도"
                                data-testid={`button-retry-${feed.id}`}
                                onClick={() => handleRetryFeed(feed.id)}
                                disabled={syncFeedsMutation.isPending}
                              >
                                <RefreshCw className={`h-4 w-4 ${syncFeedsMutation.isPending ? 'animate-spin' : ''}`} />
                              </button>
                              <button
                                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                                title="편집"
                                data-testid={`button-edit-${feed.id}`}
                                onClick={() => handleEditFeed(feed)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                className="p-1 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                                title="삭제"
                                data-testid={`button-delete-${feed.id}`}
                                onClick={() => handleDeleteFeed(feed.id, feed.title)}
                                disabled={deleteFeedMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  등록된 Feed가 없습니다
                </div>
              )}
            </div>
          )}

          {activeTab === 'subscriptions' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-medium">사용자별 구독 관리</h4>
                <Badge variant="outline">
                  총 구독: {subscriptionsData?.length || 0}개
                </Badge>
              </div>

              {/* Subscription 목록 */}
              {subscriptionsData && subscriptionsData.length > 0 ? (
                <div className="max-h-96 overflow-y-auto space-y-3">
                  {subscriptionsData.map((subscription: any) => (
                    <div key={subscription.id} className="p-4 bg-background rounded-lg border">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium">{subscription.alias}</p>
                            <Badge variant="outline" className="text-xs">
                              사용자 ID: {subscription.userId}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              피드 번호: {subscription.feedId}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <div>가시성: {subscription.visibility}</div>
                            <div>동기화: {subscription.syncInterval}시간</div>
                            <div>알림: {subscription.notifyPolicy}</div>
                            <div>활성: {subscription.enabled ? '예' : '아니오'}</div>
                          </div>

                          {subscription.userTags && (
                            <div className="mt-2">
                              <div className="flex flex-wrap gap-1">
                                {JSON.parse(subscription.userTags).map((tag: string, index: number) => (
                                  <Badge key={index} variant="outline" className="text-xs px-2">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <Badge variant={subscription.enabled ? 'default' : 'secondary'}>
                          {subscription.enabled ? '활성' : '비활성'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  등록된 구독이 없습니다
                </div>
              )}
            </div>
          )}

          {activeTab === 'policy' && (
            <div className="space-y-4">
              <h4 className="font-medium">시스템 설정</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">사용자당 최대 피드</label>
                  <Select
                    value={String(rssPolicy?.maxFeedsPerUser || 10)}
                    onValueChange={(value) => {
                      updateRssPolicyMutation.mutate({ maxFeedsPerUser: parseInt(value) });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5개</SelectItem>
                      <SelectItem value="10">10개</SelectItem>
                      <SelectItem value="20">20개</SelectItem>
                      <SelectItem value="50">50개</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">일일 페치 한도</label>
                  <Select
                    value={String(rssPolicy?.dailyFetchLimit || 1000)}
                    onValueChange={(value) => {
                      updateRssPolicyMutation.mutate({ dailyFetchLimit: parseInt(value) });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="500">500회</SelectItem>
                      <SelectItem value="1000">1,000회</SelectItem>
                      <SelectItem value="2000">2,000회</SelectItem>
                      <SelectItem value="5000">5,000회</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">승인 필요</span>
                <Switch
                  checked={rssPolicy?.requireApproval || false}
                  onCheckedChange={(checked) => {
                    updateRssPolicyMutation.mutate({ requireApproval: checked });
                  }}
                  disabled={updateRssPolicyMutation.isPending}
                />
              </div>

              <div className="space-y-3 p-4 bg-blue-50 rounded-lg">
                <h5 className="font-medium text-blue-800">중복 처리 정책</h5>
                <div className="text-sm text-blue-700 space-y-1">
                  <p>• 주소 정리: 동일한 형식으로 통일</p>
                  <p>• 중복 검사: 같은 피드 방지</p>
                  <p>• 효율적 수집: 피드별 1회 수집 후 사용자에게 배포</p>
                  <p>• 자동 차단: 5회 연속 실패 시 비활성화</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 상세 보기 모달 */}
      <Dialog open={!!selectedFeedForDetail} onOpenChange={() => setSelectedFeedForDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rss className="h-5 w-5" />
              피드 상세 정보
            </DialogTitle>
            <DialogDescription>
              {selectedFeedForDetail?.title}
            </DialogDescription>
          </DialogHeader>
          
          {selectedFeedForDetail && (
            <div className="space-y-6">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">식별번호</Label>
                  <p className="text-sm text-gray-900 mt-1">{selectedFeedForDetail.id}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700">상태</Label>
                  <div className="mt-1">
                    <Badge variant={selectedFeedForDetail.isBlocked ? 'destructive' : 'default'}>
                      {selectedFeedForDetail.isBlocked ? '차단됨' : '활성'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* URL 정보 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium text-gray-700">피드 주소</Label>
                  <p className="text-sm text-gray-900 mt-1 break-all">{selectedFeedForDetail.canonicalUrl}</p>
                </div>
              </div>

              {/* 상태 정보 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">에러 횟수</Label>
                  <p className={`text-sm mt-1 ${selectedFeedForDetail.errorCount > 3 ? 'text-red-600 font-bold' : 'text-gray-900'}`}>
                    {selectedFeedForDetail.errorCount}회
                  </p>
                </div>
              </div>

              {/* 실행 이력 */}
              <div>
                <Label className="text-sm font-medium text-gray-700">최근 실행 이력</Label>
                <div className="mt-2 space-y-2">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {selectedFeedForDetail.lastRunAt 
                          ? new Date(selectedFeedForDetail.lastRunAt).toLocaleString('ko-KR')
                          : '실행 기록 없음'
                        }
                      </span>
                      <Badge variant={selectedFeedForDetail.lastError ? 'destructive' : 'default'}>
                        {selectedFeedForDetail.lastError ? '실패' : '성공'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              {/* 에러 로그 */}
              {selectedFeedForDetail.lastError && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">최근 에러 메시지</Label>
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">{selectedFeedForDetail.lastError}</p>
                  </div>
                </div>
              )}

              {/* 개별 정책 설정 */}
              <div>
                <Label className="text-sm font-medium text-gray-700">개별 정책 설정</Label>
                <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-700">현재 전역 정책을 따릅니다. 개별 설정은 추후 구현 예정입니다.</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedFeedForDetail(null)}>
              닫기
            </Button>
            <Button onClick={() => {
              // 편집 모드로 전환하는 로직 추가 예정
              console.log('편집 모드:', selectedFeedForDetail?.id);
            }}>
              편집
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 편집 모달 */}
      <Dialog open={!!editingFeed} onOpenChange={() => setEditingFeed(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>피드 편집</DialogTitle>
            <DialogDescription>
              피드 제목과 URL을 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="title" className="text-sm font-medium">피드 제목</Label>
              <Input
                id="title"
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="피드 제목을 입력하세요"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="url" className="text-sm font-medium">피드 URL</Label>
              <Input
                id="url"
                value={editForm.url}
                onChange={(e) => setEditForm(prev => ({ ...prev, url: e.target.value }))}
                placeholder="RSS 피드 URL을 입력하세요"
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFeed(null)}>
              취소
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={editFeedMutation.isPending || !editForm.title.trim() || !editForm.url.trim()}
            >
              {editFeedMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
        title="피드 삭제"
        description={`정말로 "${confirmDialog.data?.feedTitle || ''}" 피드를 삭제하시겠습니까?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        onConfirm={handleConfirmAction}
        variant="destructive"
      />
    </>
  );
}

// 2.3 Scheduler Control Component - 개선된 UI/UX
interface SchedulerControlProps {
  triggerSyncMutation: any;
  selectedRssFeeds: Set<number>;
  syncFeedsMutation: any;
  schedulerStatus?: any;
}

function SchedulerControl({ triggerSyncMutation, selectedRssFeeds, syncFeedsMutation, schedulerStatus }: SchedulerControlProps) {
  const [isSelectiveModalOpen, setIsSelectiveModalOpen] = useState(false);
  const [selectedModalFeeds, setSelectedModalFeeds] = useState<Set<number>>(new Set());
  const { data: feedsData } = useQuery<RssFeed[]>({
    queryKey: ["/api/admin/feeds"],
    refetchInterval: 60000,
  });

  const scheduler = schedulerStatus;
  const isSchedulerRunning = scheduler?.isRunning || false;
  const lastRun = scheduler?.lastRun;
  const nextRun = scheduler?.nextRun;
  
  // 실행 중인 작업 수 계산
  const activeJobsCount = scheduler?.jobs?.filter((job: any) => job.running).length || 0;

  const formatDateTime = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSchedulerToggle = () => {
    if (isSchedulerRunning) {
      triggerSyncMutation.mutate('stop');
    } else {
      triggerSyncMutation.mutate('restart');
    }
  };

  const handleSelectiveSync = () => {
    if (selectedModalFeeds.size === 0) return;
    syncFeedsMutation.mutate(Array.from(selectedModalFeeds));
    setIsSelectiveModalOpen(false);
    setSelectedModalFeeds(new Set());
  };

  return (
    <div className="space-y-6">

      {/* 메인 제어 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 왼쪽: 스케줄러 제어 */}
        <Card className="border-l-4 border-l-brand">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              스케줄러 제어
            </CardTitle>
            <CardDescription>
              자동 스케줄러 ON/OFF 및 수동 실행
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* ON/OFF 토글 */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <h4 className="font-medium">자동 스케줄러</h4>
                <p className="text-sm text-muted-foreground">
                  {isSchedulerRunning ? 'RSS 피드와 시스템 소스를 자동으로 동기화합니다' : '자동 동기화가 중지되었습니다'}
                </p>
              </div>
              <Switch
                checked={isSchedulerRunning}
                onCheckedChange={handleSchedulerToggle}
                disabled={triggerSyncMutation.isPending}
                className="data-[state=checked]:bg-green-600"
              />
            </div>

            <Separator />

            {/* 수동 실행 버튼들 */}
            <div className="space-y-4">
              <h4 className="font-medium">수동 실행</h4>
              
              {/* 전체 동기화 */}
              <Button
                onClick={() => triggerSyncMutation.mutate('all')}
                disabled={triggerSyncMutation.isPending}
                className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white text-base"
              >
                {triggerSyncMutation.isPending ? (
                  <RefreshCw className="h-5 w-5 mr-3 animate-spin" />
                ) : (
                  <Zap className="h-5 w-5 mr-3" />
                )}
                전체 동기화
                <span className="ml-2 text-sm opacity-90">(RSS + 시스템)</span>
              </Button>

              {/* 개별 동기화 버튼들 */}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => triggerSyncMutation.mutate('rss')}
                  disabled={triggerSyncMutation.isPending}
                  variant="outline"
                  className="h-12"
                >
                  <Rss className="h-4 w-4 mr-2" />
                  RSS 동기화
                </Button>
                <Button
                  onClick={() => triggerSyncMutation.mutate('system')}
                  disabled={triggerSyncMutation.isPending}
                  variant="outline"
                  className="h-12"
                >
                  <Server className="h-4 w-4 mr-2" />
                  시스템 소스
                </Button>
              </div>

              {/* 선택 실행 버튼 */}
              <Button
                onClick={() => setIsSelectiveModalOpen(true)}
                disabled={!feedsData || feedsData.length === 0}
                variant="outline"
                className="w-full h-12"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                선택 실행
                <span className="ml-2 text-xs text-muted-foreground">
                  ({feedsData?.length || 0}개 피드)
                </span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 오른쪽: 실행 상태 및 피드백 */}
        <Card className="border-l-4 border-l-brand">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              실행 상태
            </CardTitle>
            <CardDescription>
              최근 동기화 실행 결과 및 상태
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 실행 중 상태 표시 */}
            {(triggerSyncMutation.isPending || syncFeedsMutation.isPending) && (
              <div className="p-4 bg-brand-subtle border border-brand rounded-lg">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 text-brand animate-spin" />
                  <div>
                    <p className="font-medium text-brand">동기화 실행 중...</p>
                    <p className="text-sm text-brand">
                      {triggerSyncMutation.isPending ? '시스템 동기화 진행 중' : 'RSS 피드 동기화 진행 중'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 스케줄러 작업 상태 */}
            {scheduler?.jobs && scheduler.jobs.length > 0 && (
              <div className="space-y-2">
                <h5 className="font-medium text-sm">활성 작업</h5>
                {scheduler.jobs.map((job: any) => (
                  <div key={job.name} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm font-medium">{job.name}</span>
                    <Badge variant={job.running ? 'default' : 'secondary'}>
                      {job.running ? '실행 중' : '대기'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {/* 시스템 상태 요약 */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">총 문서</p>
                <p className="text-xl font-bold">{adminStats?.totalDocuments || 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">RSS 피드</p>
                <p className="text-xl font-bold">{feedsData?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 선택 실행 모달 */}
      <Dialog open={isSelectiveModalOpen} onOpenChange={setIsSelectiveModalOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>동기화할 RSS 피드 선택</DialogTitle>
            <DialogDescription>
              동기화할 RSS 피드를 선택하고 실행하세요.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {feedsData && feedsData.length > 0 ? (
              feedsData.map((feed) => (
                <div key={feed.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedModalFeeds.has(feed.id)}
                    onChange={(e) => {
                      const newSelected = new Set(selectedModalFeeds);
                      if (e.target.checked) {
                        newSelected.add(feed.id);
                      } else {
                        newSelected.delete(feed.id);
                      }
                      setSelectedModalFeeds(newSelected);
                    }}
                    className="rounded mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium break-words">{feed.title}</p>
                    <p className="text-sm text-muted-foreground break-all">
                      {feed.canonicalUrl}
                    </p>
                    <div className="flex items-center gap-4 mt-1">
                      <Badge variant={feed.isBlocked ? 'destructive' : 'default'}>
                        {feed.category}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        에러: {feed.errorCount}회
                      </span>
                      {feed.lastSuccessAt && (
                        <span className="text-xs text-muted-foreground">
                          최근 성공: {formatDateTime(feed.lastSuccessAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8">
                <Rss className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">등록된 RSS 피드가 없습니다.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsSelectiveModalOpen(false);
              setSelectedModalFeeds(new Set());
            }}>
              취소
            </Button>
            <Button 
              onClick={handleSelectiveSync}
              disabled={selectedModalFeeds.size === 0 || syncFeedsMutation.isPending}
            >
              {syncFeedsMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              선택된 {selectedModalFeeds.size}개 피드 동기화
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 3. Document Management Section
interface DocumentManagementProps {
  expiredDocuments?: any[];
}

function DocumentManagement({ expiredDocuments }: DocumentManagementProps) {
  const [selectedDocuments, setSelectedDocuments] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'uploads' | 'saved' | 'rss'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 관리자 문서 조회 - 백엔드 API 계약에 맞는 파라미터 사용
  const documentsApiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (searchTerm) params.append('search', searchTerm);
    if (categoryFilter !== 'all') params.append('category', categoryFilter);
    // type 파라미터 사용 (백엔드 지원 파라미터)
    if (typeFilter !== 'all') params.append('type', typeFilter);
    params.append('limit', '50');
    return `/api/admin/documents?${params.toString()}`;
  }, [searchTerm, categoryFilter, typeFilter]);

  const { data: documentsResponse } = useQuery<{ documents: Document[], total: number }>({
    queryKey: [documentsApiUrl],
    refetchInterval: 60000,
  });

  // 검색과 필터링을 위한 문서 처리
  const filteredDocuments = useMemo(() => {
    const docs = documentsResponse?.documents || [];
    return docs.filter((doc: Document) => {
      const matchesSearch = !searchTerm || 
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (doc.author && doc.author.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = categoryFilter === 'all' || doc.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [documentsResponse, searchTerm, categoryFilter]);

  // 페이지네이션 계산
  const totalItems = filteredDocuments.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const allDocuments = filteredDocuments.slice(startIndex, endIndex);

  // 검색이나 필터가 변경되면 첫 페이지로 이동
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter, typeFilter]);

  // 문서 업데이트 mutation
  const updateDocumentMutation = useMutation({
    mutationFn: async (updates: { id: number; title: string; category: string; isPublic: boolean; author: string }) => {
      const { id, ...updateData } = updates;
      console.log('[DEBUG] Sending to server:', updateData);
      console.log('[DEBUG] Request URL:', `/api/admin/documents/${id}`);
      
      const response = await apiRequest(`/api/admin/documents/${id}`, {
        method: "PATCH",
        json: updateData,
      });
      console.log('[DEBUG] Server response:', response);
      return response;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expired-documents"] });
      toast({ title: "문서가 성공적으로 업데이트되었습니다." });
      setIsEditModalOpen(false);
      setEditingDocument(null);
    },
    onError: () => {
      toast({ title: "오류", description: "문서 업데이트에 실패했습니다", variant: "destructive" });
    },
  });

  // 만료 문서 정리 mutation
  const cleanupExpiredMutation = useMutation({
    mutationFn: () => apiRequest("/api/admin/cleanup-expired", { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expired-documents"] });
      toast({
        title: "정리 완료",
        description: `${data.deletedCount}개의 만료된 문서가 삭제되었습니다.`,
      });
    },
    onError: () => {
      toast({ title: "오류", description: "문서 정리에 실패했습니다", variant: "destructive" });
    },
  });

  // is_permanent 토글 mutation
  const togglePermanentMutation = useMutation({
    mutationFn: async ({ id, isPermanent }: { id: number; isPermanent: boolean }) => {
      return apiRequest(`/api/admin/documents/${id}/permanent`, {
        method: "PATCH",
        body: JSON.stringify({ isPermanent }),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/documents"] });
      toast({ title: "영구 보존 설정이 변경되었습니다." });
    },
    onError: () => {
      toast({ title: "오류", description: "설정 변경에 실패했습니다", variant: "destructive" });
    },
  });

  const handleTogglePermanent = (id: number, isPermanent: boolean) => {
    togglePermanentMutation.mutate({ id, isPermanent });
  };

  // States for delete confirmation dialog
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletePreviews, setDeletePreviews] = useState<any[]>([]);
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);

  // 선택 문서 삭제 mutation (새로운 bulk delete API 사용)
  const bulkDeleteMutation = useMutation({
    mutationFn: async (documentIds: number[]) => {
      return apiRequest("/api/admin/documents/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ documentIds }),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/documents/expired"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduler/status"] });
      setSelectedDocuments(new Set());
      setIsDeleteDialogOpen(false);
      setDeletePreviews([]);
      
      const errorCount = data.errors ? data.errors.length : 0;
      toast({
        title: "일괄 삭제 완료",
        description: `${data.deletedCount}개의 문서가 삭제되었습니다.${errorCount > 0 ? ` (${errorCount}개 실패)` : ''}`,
        variant: errorCount > 0 ? "destructive" : "default"
      });
    },
    onError: () => {
      toast({ title: "오류", description: "문서 삭제에 실패했습니다", variant: "destructive" });
    },
  });

  // Preview deletion for selected documents
  const loadDeletePreviews = async (documentIds: number[]) => {
    setIsLoadingPreviews(true);
    try {
      const previewPromises = documentIds.map(id => 
        apiRequest(`/api/admin/documents/${id}/delete-preview`)
      );
      const results = await Promise.allSettled(previewPromises);
      const previews = results
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);
      setDeletePreviews(previews);
    } catch (error) {
      console.error("Failed to load delete previews:", error);
      toast({
        title: "미리보기 로드 실패",
        description: "삭제 영향도를 확인할 수 없습니다.",
        variant: "destructive"
      });
    } finally {
      setIsLoadingPreviews(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDocuments.size === 0) {
      toast({
        title: "선택된 문서 없음",
        description: "삭제할 문서를 선택해주세요.",
        variant: "destructive"
      });
      return;
    }
    
    // Load deletion previews and show dialog
    await loadDeletePreviews(Array.from(selectedDocuments));
    setIsDeleteDialogOpen(true);
  };

  const confirmBulkDelete = () => {
    bulkDeleteMutation.mutate(Array.from(selectedDocuments));
  };

  const handleCleanupExpired = () => {
    setCleanupConfirmOpen(true);
  };

  const handleCleanupConfirm = () => {
    cleanupExpiredMutation.mutate();
    setCleanupConfirmOpen(false);
  };

  const handleEditDocument = (doc: Document) => {
    console.log('[DEBUG] Original document:', doc);
    const editDoc = { ...doc };
    console.log('[DEBUG] Edit document:', editDoc);
    setEditingDocument(editDoc);
    setIsEditModalOpen(true);
  };

  const handleSaveDocument = () => {
    if (editingDocument) {
      const updates = {
        title: editingDocument.title,
        category: editingDocument.category,
        isPublic: editingDocument.isPublic,
        author: editingDocument.author,
      };
      updateDocumentMutation.mutate({ id: editingDocument.id, ...updates });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="h-6 w-6 text-brand" />
        <h2 className="text-2xl font-bold text-gray-900">문서 관리</h2>
        <span className="text-sm text-gray-500">전체 문서 검색/조회/삭제</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            관리자 문서 관리
          </CardTitle>
          <CardDescription>
            모든 문서를 검색/조회 가능 - 필터 옵션: 카테고리별, 타입별 (업로드, 저장됨, RSS)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 검색 및 필터 */}
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="문서 제목으로 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(value: string) => setCategoryFilter(value)}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="카테고리" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">모든 카테고리</SelectItem>
                <SelectItem value="Academic">Academic</SelectItem>
                <SelectItem value="Literature">Literature</SelectItem>
                <SelectItem value="News">News</SelectItem>
                <SelectItem value="Essays">Essays</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(value: any) => setTypeFilter(value)}>
              <SelectTrigger className="w-28">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="uploads">업로드</SelectItem>
                <SelectItem value="saved">저장됨</SelectItem>
                <SelectItem value="rss">RSS</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 위험 동작 버튼들 (빨간색 강조) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-red-50 rounded-lg border border-red-200">
            <Button
              onClick={handleCleanupExpired}
              disabled={cleanupExpiredMutation.isPending || !expiredDocuments?.length}
              variant="destructive"
              className="h-12"
            >
              {cleanupExpiredMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileX className="h-4 w-4 mr-2" />
              )}
              만료 문서 정리
              <span className="ml-2 text-xs">({expiredDocuments?.length || 0}개)</span>
            </Button>

            <Button
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending || selectedDocuments.size === 0}
              variant="destructive"
              className="h-12"
            >
              {bulkDeleteMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              선택 문서 삭제
              <span className="ml-2 text-xs">({selectedDocuments.size}개)</span>
            </Button>
          </div>

          {/* Explore 문서 테이블 - instructions.md: 제목, 소스, 업로드일, 카테고리, 상태, 작업 */}
          {allDocuments && allDocuments.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-8 p-3">
                      <input
                        type="checkbox"
                        checked={selectedDocuments.size === allDocuments.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDocuments(new Set(allDocuments.map(doc => doc.id)));
                          } else {
                            setSelectedDocuments(new Set());
                          }
                        }}
                        className="rounded"
                      />
                    </th>
                    <th className="text-left p-3 font-medium text-gray-700">제목</th>
                    <th className="text-left p-3 font-medium text-gray-700 w-32">소스</th>
                    <th className="text-left p-3 font-medium text-gray-700 w-28">업로드일</th>
                    <th className="text-left p-3 font-medium text-gray-700 w-24">카테고리</th>
                    <th className="text-left p-3 font-medium text-gray-700 w-16">영구</th>
                    <th className="text-left p-3 font-medium text-gray-700 w-24">만료일</th>
                    <th className="text-left p-3 font-medium text-gray-700 w-20">상태</th>
                    <th className="text-left p-3 font-medium text-gray-700 w-20">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {allDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedDocuments.has(doc.id)}
                          onChange={(e) => {
                            const newSelected = new Set(selectedDocuments);
                            if (e.target.checked) {
                              newSelected.add(doc.id);
                            } else {
                              newSelected.delete(doc.id);
                            }
                            setSelectedDocuments(newSelected);
                          }}
                          className="rounded"
                        />
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-gray-900 line-clamp-2">{doc.title}</div>
                        {doc.author && (
                          <div className="text-sm text-gray-500 mt-1">{doc.author}</div>
                        )}
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        {doc.source || doc.sourceDomain || 'Unknown'}
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        {new Date(doc.createdAt).toLocaleDateString('ko-KR')}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {doc.category}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Switch
                          checked={doc.isPermanent || false}
                          onCheckedChange={(checked) => handleTogglePermanent(doc.id, checked)}
                          className="scale-75"
                        />
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        {doc.isPermanent ? (
                          <span className="text-gray-400">-</span>
                        ) : doc.expiresAt ? (
                          new Date(doc.expiresAt).toLocaleDateString('ko-KR')
                        ) : (
                          <span className="text-gray-400">미설정</span>
                        )}
                      </td>
                      <td className="p-3">
                        {expiredDocuments?.some(exp => exp.id === doc.id) ? (
                          <Badge variant="destructive" className="text-xs">만료</Badge>
                        ) : (
                          <Badge variant="default" className="text-xs">활성</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => handleEditDocument(doc)}
                          className="text-xs h-7"
                        >
                          편집
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchTerm || categoryFilter !== 'all' || typeFilter !== 'all'
                  ? '검색 조건에 맞는 문서가 없습니다.' 
                  : '문서가 없습니다.'
                }
              </p>
            </div>
          )}

          {/* 페이지네이션 컨트롤 */}
          {filteredDocuments.length > 0 && (
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>전체 {totalItems}개 중 {startIndex + 1}-{Math.min(endIndex, totalItems)}개</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  이전
                </Button>
                <span className="text-sm text-gray-600">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  다음
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 문서 편집 모달 */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>문서 편집</DialogTitle>
            <DialogDescription>
              문서의 메타데이터를 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          {editingDocument && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="title" className="text-right">
                  제목
                </Label>
                <Input
                  id="title"
                  value={editingDocument.title}
                  onChange={(e) => setEditingDocument({
                    ...editingDocument,
                    title: e.target.value
                  })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="author" className="text-right">
                  저자
                </Label>
                <Input
                  id="author"
                  value={editingDocument.author}
                  onChange={(e) => setEditingDocument({
                    ...editingDocument,
                    author: e.target.value
                  })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="category" className="text-right">
                  카테고리
                </Label>
                <Select
                  value={editingDocument.category}
                  onValueChange={(value) => setEditingDocument({
                    ...editingDocument,
                    category: value
                  })}
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="카테고리 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Academic">Academic</SelectItem>
                    <SelectItem value="Literature">Literature</SelectItem>
                    <SelectItem value="News">News</SelectItem>
                    <SelectItem value="Essays">Essays</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="visibility" className="text-right">
                  공개 설정
                </Label>
                <div className="col-span-3 flex items-center space-x-2">
                  <Switch
                    id="visibility"
                    checked={editingDocument.isPublic}
                    onCheckedChange={(checked) => setEditingDocument({
                      ...editingDocument,
                      isPublic: checked
                    })}
                  />
                  <span className="text-sm text-muted-foreground">
                    {editingDocument.isPublic ? '공개' : '비공개'}
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              취소
            </Button>
            <Button 
              onClick={handleSaveDocument}
              disabled={updateDocumentMutation.isPending}
            >
              {updateDocumentMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              문서 삭제 확인
            </DialogTitle>
            <DialogDescription>
              선택된 {selectedDocuments.size}개의 문서와 관련된 데이터가 함께 삭제됩니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[400px] overflow-y-auto space-y-4">
            {isLoadingPreviews ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                <span>삭제 영향도 분석 중...</span>
              </div>
            ) : (
              deletePreviews.map((preview, index) => (
                <div key={preview.documentId} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-medium">{preview.documentTitle}</span>
                    <Badge variant={
                      preview.warningLevel === 'high' ? 'destructive' : 
                      preview.warningLevel === 'medium' ? 'secondary' : 'default'
                    }>
                      {preview.warningLevel === 'high' ? '높은 위험' : 
                       preview.warningLevel === 'medium' ? '중간 위험' : '낮은 위험'}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>문장:</span>
                        <span className="font-medium">{preview.relatedData.sentences}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span>단락:</span>
                        <span className="font-medium">{preview.relatedData.paragraphs}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span>노트북:</span>
                        <span className="font-medium">{preview.relatedData.notebooks}개</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>노트:</span>
                        <span className="font-medium">{preview.relatedData.notes}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span>번역 시도:</span>
                        <span className="font-medium">{preview.relatedData.translationAttempts}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span>용어집:</span>
                        <span className="font-medium">{preview.relatedData.glossaryTerms}개</span>
                      </div>
                    </div>
                  </div>
                  
                  {preview.relatedData.glossaryTerms > 0 && (
                    <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                      <AlertCircle className="h-4 w-4 inline mr-1 text-yellow-600" />
                      용어집 항목은 삭제되지 않고 문장 참조만 해제됩니다.
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={bulkDeleteMutation.isPending}
            >
              취소
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmBulkDelete}
              disabled={bulkDeleteMutation.isPending || isLoadingPreviews}
            >
              {bulkDeleteMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {bulkDeleteMutation.isPending ? '삭제 중...' : '확인 및 삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cleanupConfirmOpen}
        onOpenChange={setCleanupConfirmOpen}
        title="만료된 문서 정리"
        description={`만료된 문서 ${expiredDocuments?.length || 0}개를 정리하시겠습니까?`}
        confirmLabel="정리"
        cancelLabel="취소"
        onConfirm={handleCleanupConfirm}
        variant="default"
      />
    </div>
  );
}

// 5. User Management Section
function UserManagement() {
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editRole, setEditRole] = useState("");
  const { toast } = useToast();
  const { timezone, language } = useTimezone();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<AdminUsersResponse>({
    queryKey: ["/api/admin/users", { page, search, plan: planFilter, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (search) params.set("search", search);
      if (planFilter !== "all") params.set("plan", planFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiRequest(`/api/admin/users?${params.toString()}`);
      return res as AdminUsersResponse;
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, updates }: { userId: number; updates: Record<string, string> }) => {
      return await apiRequest(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "사용자 정보가 업데이트되었습니다" });
      setEditingUser(null);
    },
    onError: () => {
      toast({ title: "오류", description: "사용자 정보 업데이트에 실패했습니다", variant: "destructive" });
    },
  });

  const openEditDialog = (user: AdminUser) => {
    setEditingUser(user);
    setEditPlan(user.plan);
    setEditStatus(user.status);
    setEditRole(user.role);
  };

  const handleSaveEdit = () => {
    if (!editingUser) return;
    updateUserMutation.mutate({
      userId: editingUser.id,
      updates: { plan: editPlan, status: editStatus, role: editRole },
    });
  };

  const formatAdminDateTime = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
    return formatDateTime(dateString, { timezone, language });
  };

  const getPlanBadge = (plan: string) => {
    const variants: Record<string, string> = {
      starter: "bg-gray-100 text-gray-700",
      pro: "bg-blue-100 text-blue-700",
      admin: "bg-red-100 text-red-700",
      beta_pro: "bg-purple-100 text-purple-700",
    };
    return <Badge className={variants[plan] || "bg-gray-100 text-gray-700"}>{plan}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      active: "bg-green-100 text-green-700",
      locked: "bg-red-100 text-red-700",
      pending: "bg-yellow-100 text-yellow-700",
    };
    return <Badge className={variants[status] || "bg-gray-100 text-gray-700"}>{status}</Badge>;
  };

  const users = data?.users || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            사용자 관리
          </CardTitle>
          <CardDescription>사용자 목록 및 플랜/상태 관리</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="사용자 검색 (이름, 이메일)"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="플랜" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 플랜</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="beta_pro">Beta Pro</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="locked">Locked</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" />
              <span>로딩 중...</span>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">사용자가 없습니다</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-2 font-medium">Username</th>
                    <th className="py-2 px-2 font-medium">Email</th>
                    <th className="py-2 px-2 font-medium">Plan</th>
                    <th className="py-2 px-2 font-medium">Status</th>
                    <th className="py-2 px-2 font-medium">Role</th>
                    <th className="py-2 px-2 font-medium">OAuth</th>
                    <th className="py-2 px-2 font-medium">Last Login</th>
                    <th className="py-2 px-2 font-medium">Joined</th>
                    <th className="py-2 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-2 font-medium">{user.username}</td>
                      <td className="py-2 px-2 text-muted-foreground">{user.email || "-"}</td>
                      <td className="py-2 px-2">{getPlanBadge(user.plan)}</td>
                      <td className="py-2 px-2">{getStatusBadge(user.status)}</td>
                      <td className="py-2 px-2">{user.role}</td>
                      <td className="py-2 px-2">{user.oauthProvider || "-"}</td>
                      <td className="py-2 px-2 text-xs">{formatAdminDateTime(user.lastLoginAt)}</td>
                      <td className="py-2 px-2 text-xs">{formatAdminDateTime(user.createdAt)}</td>
                      <td className="py-2 px-2">
                        <Button size="sm" variant="ghost" onClick={() => openEditDialog(user)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination && pagination.totalPages > 0 && (
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total}명)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingUser} onOpenChange={(open) => { if (!open) setEditingUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사용자 수정 - {editingUser?.username}</DialogTitle>
            <DialogDescription>플랜, 상태, 역할을 변경할 수 있습니다</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>플랜</Label>
              <Select value={editPlan} onValueChange={setEditPlan}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="beta_pro">Beta Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>상태</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>역할</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="moderator">Moderator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>취소</Button>
            <Button onClick={handleSaveEdit} disabled={updateUserMutation.isPending}>
              {updateUserMutation.isPending ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 4. Sync Logs Section
function SyncLogsSection() {
  const { data: syncLogs, isLoading } = useQuery<SyncLog[]>({
    queryKey: ["/api/admin/sync-logs"],
    refetchInterval: 30000,
  });

  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          동기화 로그
        </CardTitle>
        <CardDescription>
          최근 동기화 작업 기록
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            <span>로그 불러오는 중...</span>
          </div>
        ) : syncLogs && syncLogs.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-700 w-36">실행 시간</th>
                  <th className="text-left p-3 font-medium text-gray-700 w-24">소스 유형</th>
                  <th className="text-left p-3 font-medium text-gray-700">소스명</th>
                  <th className="text-left p-3 font-medium text-gray-700 w-24">작업</th>
                  <th className="text-left p-3 font-medium text-gray-700 w-20">상태</th>
                  <th className="text-left p-3 font-medium text-gray-700 w-24">처리/추가</th>
                  <th className="text-left p-3 font-medium text-gray-700 w-20">소요시간</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {syncLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="p-3 text-sm text-gray-600">
                      {new Date(log.executedAt).toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">
                        {log.sourceType}
                      </Badge>
                    </td>
                    <td className="p-3 text-sm text-gray-900 truncate max-w-[200px]">
                      {log.sourceName}
                    </td>
                    <td className="p-3 text-sm text-gray-600">
                      {log.action}
                    </td>
                    <td className="p-3">
                      {log.status === 'success' ? (
                        <Badge className="bg-green-100 text-green-800 text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          성공
                        </Badge>
                      ) : log.status === 'failure' ? (
                        <Badge variant="destructive" className="text-xs">
                          <XCircle className="h-3 w-3 mr-1" />
                          실패
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          대기
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-sm text-gray-600">
                      {log.itemsProcessed}/{log.itemsAdded}
                      {log.itemsFailed > 0 && (
                        <span className="text-red-500 ml-1">({log.itemsFailed} 실패)</span>
                      )}
                    </td>
                    <td className="p-3 text-sm text-gray-500">
                      {formatDuration(log.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">동기화 로그가 없습니다.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}