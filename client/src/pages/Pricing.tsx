import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Check, 
  Crown, 
  Zap, 
  BookOpen, 
  Languages, 
  Sparkles, 
  FileText,
  ArrowLeft,
  Loader2,
  Shield,
  X,
  ShieldCheck,
  MessageCircle,
  Camera,
  GraduationCap,
  Download,
  Brain,
  Infinity
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import Layout from "@/components/Layout";

declare global {
  interface Window {
    PortOne?: {
      requestPayment: (params: {
        storeId: string;
        channelKey?: string;
        paymentId: string;
        orderName: string;
        totalAmount: number;
        currency: "CURRENCY_KRW";
        payMethod: "CARD";
        customer?: {
          fullName?: string;
          email?: string;
          phoneNumber?: string;
        };
      }) => Promise<{
        paymentId?: string;
        status?: string;
        code?: string;
        message?: string;
      }>;
    };
  }
}

export default function Pricing() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isYearly, setIsYearly] = useState(true);

  const monthlyPrice = 14900;
  const yearlyPrice = 9900;
  const currentPrice = isYearly ? yearlyPrice : monthlyPrice;
  const totalAmount = isYearly ? yearlyPrice * 12 : monthlyPrice;

  useEffect(() => {
    const existingScript = document.querySelector('script[src="https://cdn.portone.io/v2/browser-sdk.js"]');
    if (existingScript) {
      setIsSDKLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.portone.io/v2/browser-sdk.js";
    script.async = true;
    script.onload = () => {
      setIsSDKLoaded(true);
    };
    script.onerror = () => {
      console.error("Failed to load PortOne SDK");
      toast({
        title: t('pricing.sdkLoadError') || "Payment SDK Error",
        description: t('pricing.sdkLoadErrorDesc') || "Failed to load payment system. Please refresh the page.",
        variant: "destructive",
      });
    };
    document.body.appendChild(script);

    return () => {
      // Don't remove the script on unmount as it might be needed elsewhere
    };
  }, [toast, t]);

  const paymentCompleteMutation = useMutation({
    mutationFn: async (data: { paymentId: string; merchant_uid: string; planType: "monthly" | "annual" }) => {
      return await apiRequest("/api/payment/complete", {
        method: "POST",
        json: data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation("/payment-success");
    },
    onError: (error: Error) => {
      console.error("Payment verification failed:", error);
      setLocation("/payment-failed");
    },
  });

  const handleSubscribePro = () => {
    if (!isAuthenticated) {
      toast({
        title: t('auth.loginRequired') || "Login Required",
        description: t('pricing.loginToSubscribe') || "Please login to subscribe to Pro plan.",
      });
      setLocation("/login");
      return;
    }

    if (!isSDKLoaded || !window.PortOne) {
      toast({
        title: t('pricing.sdkNotReady') || "Payment System Not Ready",
        description: t('pricing.sdkNotReadyDesc') || "Please wait for the payment system to load.",
        variant: "destructive",
      });
      return;
    }

    setShowPaymentModal(true);
  };

  const handleConfirmPayment = async () => {
    setShowPaymentModal(false);
    setIsProcessing(true);

    try {
      const config = await apiRequest<{ storeId: string; channelKey: string }>("/api/payment/config");
      const { storeId, channelKey } = config;
      
      console.log(`[Payment] Using storeId: ${storeId?.substring(0, 8)}..., channelKey: ${channelKey?.substring(0, 15)}...`);
      
      const merchantUid = `order_${Date.now()}_${user?.id || 'guest'}`;

      const paymentResponse = await window.PortOne!.requestPayment({
        storeId,
        channelKey,
        paymentId: merchantUid,
        orderName: `ReadAcross Pro (${isYearly ? 'Annual' : 'Monthly'})`,
        totalAmount,
        currency: "CURRENCY_KRW",
        payMethod: "CARD",
        customer: {
          fullName: user?.username,
          email: user?.email,
          phoneNumber: "01000000000",
        },
      });

      setIsProcessing(false);

      if (paymentResponse?.code) {
        if (paymentResponse.code === "UserCancel" || paymentResponse.code === "USER_CANCEL") {
          return;
        }
        console.error("Payment failed:", paymentResponse.code, paymentResponse?.message);
        toast({
          title: t('pricing.paymentFailed') || "Payment Failed",
          description: paymentResponse?.message || t('pricing.paymentFailedDesc') || "Payment was not completed. Please try again.",
          variant: "destructive",
        });
        return;
      }

      if (paymentResponse?.paymentId) {
        paymentCompleteMutation.mutate({
          paymentId: paymentResponse.paymentId,
          merchant_uid: merchantUid,
          planType: isYearly ? "annual" : "monthly",
        });
      }
    } catch (error: any) {
      setIsProcessing(false);
      console.error("Payment initialization error:", JSON.stringify(error, null, 2));
      toast({
        title: t('pricing.paymentError') || "Payment Error",
        description: error?.message || t('pricing.paymentErrorDesc') || "An error occurred while initializing payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  const isPro = user?.plan === "pro" || user?.plan === "admin" || user?.plan === "beta_pro";

  const starterFeatures = [
    { icon: FileText, text: t('pricing.starterFeature1') },
    { icon: Zap, text: t('pricing.starterFeature2') },
    { icon: Languages, text: t('pricing.starterFeature3') },
    { icon: Camera, text: t('pricing.starterFeature4') },
    { icon: X, text: t('pricing.starterFeature5') },
  ];

  const proFeatures = [
    { icon: Zap, text: t('pricing.proFeature1') },
    { icon: Sparkles, text: t('pricing.proFeature2') },
    { icon: FileText, text: t('pricing.proFeature3') },
    { icon: Languages, text: t('pricing.proFeature4') },
    { icon: Camera, text: t('pricing.proFeature5') },
    { icon: Download, text: t('pricing.proFeature6') },
    { icon: Shield, text: t('pricing.proFeature7') },
  ];

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container max-w-5xl py-8 px-4 mx-auto">
        <Button
          variant="ghost"
          onClick={() => window.history.back()}
          className="mb-6"
          data-testid="button-back"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('common.back') || "Back"}
        </Button>

        <div className="text-center mb-12">
          <p className="text-sm text-brand font-medium mb-2 tracking-wide">Quiet Support</p>
          <h1 className="text-3xl font-bold mb-4" data-testid="text-pricing-title">
            {t('pricing.title')}
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-8">
            {t('pricing.subtitle')}
          </p>
          
          <div className="flex items-center justify-center gap-4 bg-muted/50 rounded-full px-6 py-3 w-fit mx-auto">
            <Label 
              htmlFor="billing-toggle" 
              className={`text-sm cursor-pointer transition-colors ${!isYearly ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              {t('pricing.monthly')}
            </Label>
            <Switch
              id="billing-toggle"
              checked={isYearly}
              onCheckedChange={setIsYearly}
            />
            <Label 
              htmlFor="billing-toggle" 
              className={`text-sm cursor-pointer transition-colors ${isYearly ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              {t('pricing.yearly')}
              <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {t('pricing.yearlyDiscount')}
              </Badge>
            </Label>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Starter Plan */}
          <Card className="relative border-2 bg-gradient-to-b from-background to-muted/20" data-testid="card-starter-plan">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <BookOpen className="h-6 w-6 text-muted-foreground" />
                {t('pricing.starterPlan') || "Starter"}
              </CardTitle>
              <CardDescription className="text-base">
                {t('pricing.starterPlanDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">₩0</span>
                <span className="text-muted-foreground ml-2">{t('pricing.freeForever')}</span>
              </div>
              <ul className="space-y-4">
                {starterFeatures.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <feature.icon className="h-5 w-5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{feature.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-4">
                {t('pricing.starterHelper')}
              </p>
            </CardContent>
            <CardFooter>
              {!isAuthenticated ? (
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => setLocation("/login")}
                  data-testid="button-get-started-starter"
                >
                  {t('pricing.getStarted') || "무료로 시작하기"}
                </Button>
              ) : !isPro ? (
                <Badge variant="secondary" className="w-full justify-center py-2">
                  {t('pricing.currentPlan') || "현재 플랜"}
                </Badge>
              ) : (
                <Badge variant="outline" className="w-full justify-center py-2">
                  {t('pricing.included') || "Pro에 포함"}
                </Badge>
              )}
            </CardFooter>
          </Card>

          {/* Pro Plan */}
          <Card className="relative border-2 border-primary shadow-xl bg-gradient-to-b from-background to-brand/5" data-testid="card-pro-plan">
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand px-4 py-1">
              {t('pricing.recommended') || "추천"}
            </Badge>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Crown className="h-6 w-6 text-brand" />
                {t('pricing.proPlan') || "Pro"}
              </CardTitle>
              <CardDescription className="text-base">
                {t('pricing.proPlanDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-brand">₩{currentPrice.toLocaleString()}</span>
                  <span className="text-muted-foreground">{t('pricing.perMonth')}</span>
                </div>
                {isYearly && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm text-muted-foreground line-through">₩{monthlyPrice.toLocaleString()}</span>
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      {t('pricing.yearlySavings', { amount: `₩${((monthlyPrice - yearlyPrice) * 12).toLocaleString()}` })}
                    </Badge>
                  </div>
                )}
                {!isYearly && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('pricing.yearlyPriceHint', { price: `₩${yearlyPrice.toLocaleString()}` })}
                  </p>
                )}
              </div>
              <ul className="space-y-4">
                {proFeatures.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <feature.icon className="h-5 w-5 flex-shrink-0 mt-0.5 text-brand/70" />
                    <span className="text-sm font-medium text-foreground">{feature.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-4">
                {t('pricing.proHelper')}
              </p>
            </CardContent>
            <CardFooter>
              {isPro ? (
                <Badge className="w-full justify-center py-2 bg-brand">
                  <Crown className="mr-2 h-4 w-4" />
                  {t('pricing.currentPlan') || "현재 플랜"}
                </Badge>
              ) : (
                <div className="w-full space-y-3">
                  <Button 
                    className="w-full bg-brand hover:bg-brand-hover h-12 text-base rounded-xl"
                    onClick={handleSubscribePro}
                    disabled={isProcessing || paymentCompleteMutation.isPending || !isSDKLoaded}
                    data-testid="button-subscribe-pro"
                  >
                    {isProcessing || paymentCompleteMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('pricing.processing') || "처리 중..."}
                      </>
                    ) : (
                      <>
                        <Crown className="mr-2 h-4 w-4" />
                        {t('pricing.upgradeToPro') || "Pro로 업그레이드"}
                      </>
                    )}
                  </Button>
                  <div className="text-center" style={{ fontSize: '11px' }}>
                    <p className="text-muted-foreground">
                      {t('pricing.singlePaymentNotice') || "본 상품은 단건 결제 상품으로 추가 결제 걱정 없이 이용하세요. (부가세 포함)"}
                    </p>
                  </div>
                </div>
              )}
            </CardFooter>
          </Card>
        </div>

        <div className="mt-12 text-center">
          <div className="bg-muted/30 rounded-2xl p-6 max-w-2xl mx-auto">
            <h3 className="font-semibold mb-3 text-lg">{t('pricing.whyPro')}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4 whitespace-pre-line">
              {t('pricing.whyProDesc')}
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-4 w-4 text-green-500" />
                {t('pricing.securePayment')}
              </span>
              <span className="flex items-center gap-1">
                <Check className="h-4 w-4 text-green-500" />
                {t('pricing.cancelAnytime')}
              </span>
              <span className="flex items-center gap-1">
                <Check className="h-4 w-4 text-green-500" />
                {t('pricing.noHiddenFees')}
              </span>
            </div>
          </div>
        </div>

        <p className="text-center text-muted-foreground mt-8" style={{ fontSize: '10px' }}>
          {t('pricing.footerRefundNotice') || "이용 내역이 없는 경우 결제 후 7일 이내에 전액 환불이 가능하며, 환불 문의는 고객센터 메일로 연락 주시면 신속히 처리해 드립니다."}
        </p>
      </div>

      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="sm:max-w-md" data-testid="modal-payment-summary">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold flex items-center gap-2">
              <Crown className="h-5 w-5 text-brand" />
              {t('pricing.paymentConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t('pricing.product')}</span>
                <span className="font-medium">{isYearly ? t('pricing.productNameYearly') : t('pricing.productNameMonthly')}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{t('pricing.billingCycle')}</span>
                <span>{isYearly ? t('pricing.billingYearly') : t('pricing.billingMonthly')}</span>
              </div>
              <div className="border-t pt-3 flex justify-between items-center">
                <span className="text-muted-foreground">{t('pricing.paymentAmount')}</span>
                <div className="text-right">
                  <span className="text-xl font-bold text-brand">₩{totalAmount.toLocaleString()}</span>
                  <span className="text-muted-foreground">
                    {isYearly ? t('pricing.totalAnnual') || "총액" : t('pricing.totalMonthly') || "총액"}
                  </span>
                  {isYearly && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {t('pricing.savingsCompare', { amount: `₩${((monthlyPrice - yearlyPrice) * 12).toLocaleString()}` })}
                    </p>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-green-50 dark:bg-green-950/30 p-3 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p>{t('pricing.cancelInfo')}</p>
            </div>
          </div>

          <DialogFooter className="flex gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button 
                variant="outline" 
                className="flex-1"
                data-testid="button-cancel-payment"
              >
                {t('pricing.cancelButton')}
              </Button>
            </DialogClose>
            <Button 
              onClick={handleConfirmPayment}
              className="flex-1 bg-brand hover:bg-brand-hover"
              data-testid="button-confirm-payment"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              {t('pricing.confirmPayment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
