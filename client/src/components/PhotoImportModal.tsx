import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Camera, X, ImageIcon, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import UpgradePromptDialog from "./UpgradePromptDialog";

interface PhotoImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_IMAGES = 2;
const MAX_WIDTH = 1200;

async function resizeImage(file: File, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };

    img.onload = () => {
      let { width, height } = img;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl);
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

type Step = "upload" | "processing" | "review";

export default function PhotoImportModal({ isOpen, onClose }: PhotoImportModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [images, setImages] = useState<{ file: File; preview: string; base64: string }[]>([]);
  const [extractedText, setExtractedText] = useState("");
  const [title, setTitle] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("ko");
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [upgradeType, setUpgradeType] = useState<"ocr" | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setError(t("ocr.maxImagesReached"));
      return;
    }

    const filesToProcess = files.slice(0, remaining);
    const validFiles = filesToProcess.filter((file) => file.type.startsWith("image/"));

    if (validFiles.length === 0) {
      setError(t("ocr.invalidImageType"));
      return;
    }

    setError(null);

    try {
      const newImages = await Promise.all(
        validFiles.map(async (file) => {
          const base64 = await resizeImage(file, MAX_WIDTH);
          return {
            file,
            preview: URL.createObjectURL(file),
            base64,
          };
        })
      );

      setImages((prev) => [...prev, ...newImages].slice(0, MAX_IMAGES));
    } catch (err) {
      setError(t("ocr.imageProcessingFailed"));
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [images.length, t]);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  const handleExtractText = useCallback(async () => {
    if (images.length === 0) {
      setError(t("ocr.noImagesSelected"));
      return;
    }

    setStep("processing");
    setIsProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch("/api/ocr/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          images: images.map((img) => img.base64),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.errorCode === "OCR_LIMIT_REACHED") {
          setUpgradeType("ocr");
          setIsProcessing(false);
          setStep("upload");
          return;
        }
        throw new Error(errorData.error || t("ocr.extractionFailed"));
      }

      const data = await response.json();
      setExtractedText(data.text || "");
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ocr.extractionFailed"));
      setStep("upload");
    } finally {
      setIsProcessing(false);
    }
  }, [images, t]);

  const handleSaveDocument = useCallback(async () => {
    if (!title.trim()) {
      setError(t("ocr.titleRequired"));
      return;
    }

    if (!extractedText.trim()) {
      setError(t("ocr.noTextToSave"));
      return;
    }

    if (sourceLanguage === targetLanguage) {
      setError(t("modal.errors.sameLanguage"));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch("/api/documents/create-from-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          title: title.trim(),
          content: extractedText.trim(),
          sourceLanguage,
          targetLanguage,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || t("ocr.saveFailed"));
      }

      toast({
        title: t("ocr.saveSuccess"),
        description: t("ocr.saveSuccessDesc"),
      });

      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ocr.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [title, extractedText, sourceLanguage, targetLanguage, t, toast]);

  const handleClose = useCallback(() => {
    if (!isProcessing && !isSaving) {
      images.forEach((img) => URL.revokeObjectURL(img.preview));
      setImages([]);
      setExtractedText("");
      setTitle("");
      setError(null);
      setStep("upload");
      onClose();
    }
  }, [isProcessing, isSaving, images, onClose]);

  const handleBack = useCallback(() => {
    setStep("upload");
    setError(null);
  }, []);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Camera className="h-5 w-5 mr-2" />
            {t("ocr.photoImport")}
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && t("ocr.uploadDescription")}
            {step === "processing" && t("ocr.processingDescription")}
            {step === "review" && t("ocr.reviewDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {step === "processing" && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <div className="relative">
                <Loader2 className="h-12 w-12 animate-spin" style={{ color: "#6B8E7E" }} />
              </div>
              <p
                className="text-lg font-medium"
                style={{ color: "#6B8E7E" }}
                data-testid="ocr-loading-text"
              >
                페이지를 조용히 아카이브로 옮기고 있습니다...
              </p>
            </div>
          )}

          {step === "upload" && (
            <>
              <div className="space-y-3">
                <Label>{t("ocr.selectImages")}</Label>
                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                    "hover:bg-accent",
                    images.length >= MAX_IMAGES
                      ? "border-muted cursor-not-allowed opacity-50"
                      : "border-border"
                  )}
                  onClick={() => images.length < MAX_IMAGES && fileInputRef.current?.click()}
                  data-testid="photo-import-dropzone"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={images.length >= MAX_IMAGES}
                  />
                  <div className="space-y-2">
                    <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">{t("ocr.clickToSelect")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("ocr.maxImages", { count: MAX_IMAGES })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("ocr.currentCount", { current: images.length, max: MAX_IMAGES })}
                    </p>
                  </div>
                </div>
              </div>

              {images.length > 0 && (
                <div className="space-y-3">
                  <Label>{t("ocr.selectedImages")}</Label>
                  <div className="grid grid-cols-2 gap-4">
                    {images.map((img, index) => (
                      <div
                        key={index}
                        className="relative rounded-lg overflow-hidden border"
                        data-testid={`selected-image-${index}`}
                      >
                        <img
                          src={img.preview}
                          alt={`Selected ${index + 1}`}
                          className="w-full h-40 object-cover"
                        />
                        <button
                          onClick={() => handleRemoveImage(index)}
                          className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
                          data-testid={`remove-image-${index}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {step === "review" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="title">{t("ocr.documentTitle")}</Label>
                <Input
                  id="title"
                  placeholder={t("ocr.titlePlaceholder")}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isSaving}
                  data-testid="ocr-title-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("ocr.sourceLanguage")}</Label>
                  <Select value={sourceLanguage} onValueChange={setSourceLanguage} disabled={isSaving}>
                    <SelectTrigger data-testid="ocr-source-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ko">한국어</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                      <SelectItem value="zh">中文</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("ocr.targetLanguage")}</Label>
                  <Select value={targetLanguage} onValueChange={setTargetLanguage} disabled={isSaving}>
                    <SelectTrigger data-testid="ocr-target-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ko">한국어</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                      <SelectItem value="zh">中文</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="extracted-text">{t("ocr.extractedText")}</Label>
                <Textarea
                  id="extracted-text"
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  disabled={isSaving}
                  rows={12}
                  className="min-h-[300px] resize-y font-mono text-sm"
                  placeholder={t("ocr.editPlaceholder")}
                  data-testid="ocr-extracted-text"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("ocr.reviewHint")}</span>
                  <span>{t("ocr.characterCount", { count: extractedText.length })}</span>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-center text-red-500 text-sm" data-testid="ocr-error">
              <AlertCircle className="h-4 w-4 mr-1" />
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t">
            {step === "upload" && (
              <>
                <Button variant="outline" onClick={handleClose}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleExtractText}
                  disabled={images.length === 0}
                  data-testid="button-extract-text"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {t("ocr.extractText")}
                </Button>
              </>
            )}

            {step === "review" && (
              <>
                <Button variant="outline" onClick={handleBack} disabled={isSaving}>
                  {t("common.back")}
                </Button>
                <Button
                  onClick={handleSaveDocument}
                  disabled={!title.trim() || !extractedText.trim() || isSaving}
                  data-testid="button-save-document"
                >
                  {isSaving ? (
                    <div className="flex items-center">
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t("common.saving")}
                    </div>
                  ) : (
                    t("ocr.saveToLibrary")
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <UpgradePromptDialog
      isOpen={upgradeType !== null}
      onClose={() => setUpgradeType(null)}
      type="ocr"
    />
    </>
  );
}
