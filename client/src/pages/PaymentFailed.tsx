import { useLocation } from "wouter";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { XCircle, ArrowLeft, RefreshCcw, HelpCircle } from "lucide-react";
import Layout from "@/components/Layout";

export default function PaymentFailed() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  return (
    <Layout>
      <div className="container max-w-2xl py-16 px-4">
        <Card className="text-center" data-testid="card-payment-failed">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-4 w-20 h-20 rounded-full bg-gradient-to-r from-red-400 to-rose-500 flex items-center justify-center">
              <XCircle className="h-12 w-12 text-white" />
            </div>
            <CardTitle className="text-3xl">
              {t('payment.failedTitle') || "Payment Failed"}
            </CardTitle>
            <CardDescription className="text-lg mt-2">
              {t('payment.failedDesc') || "We couldn't process your payment. Don't worry, no charges were made."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted/50 dark:bg-muted/30 rounded-lg p-6 text-left border border-transparent dark:border-border/50">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-muted-foreground" />
                {t('payment.commonReasons') || "Common Reasons"}
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• {t('payment.reason1') || "Insufficient funds on the card"}</li>
                <li>• {t('payment.reason2') || "Card declined by issuing bank"}</li>
                <li>• {t('payment.reason3') || "Network connection issue during payment"}</li>
                <li>• {t('payment.reason4') || "Payment was cancelled by user"}</li>
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                onClick={() => setLocation("/pricing")}
                className="bg-primary"
                data-testid="button-try-again"
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                {t('payment.tryAgain') || "Try Again"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation("/library")}
                data-testid="button-go-back"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('payment.backToLibrary') || "Back to Library"}
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              {t('payment.needHelp') || "Need help? Contact us at hello@readacross.io"}
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
