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
            서비스 점검 안내
          </DialogTitle>
          <DialogDescription className="pt-2">
            현재 ReadAcross는 서비스 고도화 및 시스템 점검 기간입니다. 점검 완료 후 더 멋진 기능으로 찾아뵙겠습니다. (2026년 2월 중 정식 오픈 예정)
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-4">
          <Button variant="outline" onClick={onClose} className="w-full">
            확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
