import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Crown, ArrowRight, Sparkles, BookOpen } from "lucide-react";
import Layout from "@/components/Layout";

export default function PaymentSuccess() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }, []);

  return (
    <Layout>
      <div className="container max-w-2xl py-16 px-4 mx-auto flex flex-col items-center">
        <Card className="text-center" data-testid="card-payment-success">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-4 w-20 h-20 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="h-12 w-12 text-white" />
            </div>
            <CardTitle className="text-3xl flex items-center justify-center gap-2">
              <Crown className="h-8 w-8 text-brand" />
              {t('payment.welcomeToPro') || "Payment Complete."}
            </CardTitle>
            <CardDescription className="text-lg mt-2">
              {t('payment.successDesc') || "You now have access to all Pro features."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-gradient-to-r from-brand-subtle to-brand-soft dark:from-brand/20 dark:to-brand/10 rounded-lg p-6 text-left border border-transparent dark:border-brand/20">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-brand" />
                {t('payment.nowUnlocked') || "Now Unlocked"}
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t('payment.unlocked1') || "Unlimited document uploads"}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t('payment.unlocked2') || "Premium AI translations with GPT-4o"}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t('payment.unlocked3') || "AI Precision Coaching for every sentence"}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t('payment.unlocked4') || "Advanced export options (PDF, TXT, CSV)"}
                </li>
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                onClick={() => setLocation("/library")}
                className="bg-brand hover:bg-brand-hover"
                data-testid="button-go-to-library"
              >
                <BookOpen className="mr-2 h-4 w-4" />
                {t('payment.goToLibrary') || "Go to My Library"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation("/explore")}
                data-testid="button-explore-content"
              >
                {t('payment.exploreContent') || "Explore Content"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
