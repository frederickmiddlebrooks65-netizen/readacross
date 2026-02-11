import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n";

interface UpgradePromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  type: "upload" | "ocr";
}

export default function UpgradePromptDialog({ isOpen, onClose, type }: UpgradePromptDialogProps) {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const title = type === "upload"
    ? t("upgrade.uploadLimitTitle")
    : t("upgrade.ocrLimitTitle");

  const description = type === "upload"
    ? t("upgrade.uploadLimitDesc")
    : t("upgrade.ocrLimitDesc");

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-yellow-500" />
            {title}
          </DialogTitle>
          <DialogDescription className="pt-2">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-4">
          <Button
            onClick={() => {
              onClose();
              setLocation("/pricing");
            }}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            <Crown className="h-4 w-4 mr-2" />
            {t("upgrade.viewPlans")}
          </Button>
          <Button variant="outline" onClick={onClose} className="w-full">
            {t("upgrade.later")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
