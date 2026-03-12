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
import { Separator } from "@/components/ui/separator";
import { AlertCircle, FileText, Upload, Type, Globe, Camera, X, ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import UpgradePromptDialog from "./UpgradePromptDialog";

interface TextContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (title: string, content: string, sourceLanguage: string) => Promise<void>;
}

type InputMode = 'text' | 'file' | 'url' | 'photo';

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

export default function TextContentModal({ isOpen, onClose, onSubmit }: TextContentModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [urlPreview, setUrlPreview] = useState<any>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Photo import states
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoImages, setPhotoImages] = useState<{ file: File; preview: string; base64: string }[]>([]);
  const [extractedText, setExtractedText] = useState("");
  const [isExtractingText, setIsExtractingText] = useState(false);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [upgradeType, setUpgradeType] = useState<"upload" | "ocr" | null>(null);

  const handlePhotoSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_IMAGES - photoImages.length;
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

      setPhotoImages((prev) => [...prev, ...newImages].slice(0, MAX_IMAGES));
      setHasExtracted(false);
    } catch (err) {
      setError(t("ocr.imageProcessingFailed"));
    }

    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  }, [photoImages.length, t]);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotoImages((prev) => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
    setHasExtracted(false);
  }, []);

  const handleExtractText = useCallback(async () => {
    if (photoImages.length === 0) {
      setError(t("ocr.noImagesSelected"));
      return;
    }

    setIsExtractingText(true);
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
          images: photoImages.map((img) => img.base64),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.errorCode === "OCR_LIMIT_REACHED") {
          setUpgradeType("ocr");
          setIsExtractingText(false);
          return;
        }
        throw new Error(errorData.error || t("ocr.extractionFailed"));
      }

      const data = await response.json();
      setExtractedText(data.text || "");
      setHasExtracted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ocr.extractionFailed"));
    } finally {
      setIsExtractingText(false);
    }
  }, [photoImages, t]);

  const handlePhotoSubmit = useCallback(async () => {
    if (!title.trim()) {
      setError(t("ocr.titleRequired"));
      return;
    }

    if (!extractedText.trim()) {
      setError(t("ocr.noTextToSave"));
      return;
    }

    setIsSubmitting(true);
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
      handleFullClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ocr.saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }, [title, extractedText, sourceLanguage, t, toast]);

  const handleFullClose = () => {
    if (!isSubmitting) {
      setTitle("");
      setContent("");
      setFile(null);
      setUrl("");
      setUrlPreview(null);
      setError(null);
      photoImages.forEach((img) => URL.revokeObjectURL(img.preview));
      setPhotoImages([]);
      setExtractedText("");
      setHasExtracted(false);
      onClose();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (selectedFile.size > maxSize) {
        setError(t('modal.errors.fileTooLarge'));
        return;
      }

      setFile(selectedFile);
      setError(null);

      if (!title) {
        const fileName = selectedFile.name.replace(/\.[^/.]+$/, "");
        setTitle(fileName);
      }

      // Read file content for text files
      if (selectedFile.type === 'text/plain') {
        const text = await selectedFile.text();
        setContent(text);
      }
    }
  };

  const handleUrlPreview = async () => {
    if (!url.trim()) {
      setError(t('modal.errors.enterUrl'));
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      setError(t('modal.errors.invalidUrlFormat'));
      return;
    }

    setError(null);
    setErrorCode(null);
    setIsLoadingPreview(true);

    try {
      const response = await fetch("/api/documents/preview-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (data.errorCode === 'URL_ACCESS_BLOCKED') {
        setErrorCode('URL_ACCESS_BLOCKED');
        setError(t('modal.errors.urlAccessBlocked'));
        return;
      }
      if (data.errorCode === 'URL_NOT_FOUND') {
        setError(t('modal.errors.urlNotFound'));
        return;
      }
      if (data.errorCode === 'URL_TIMEOUT') {
        setError(t('modal.errors.urlTimeout'));
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || t('modal.errors.urlFetchFailed'));
      }

      setUrlPreview(data);

      // Auto-fill title if empty
      if (!title && data.title) {
        setTitle(data.title);
      }

    } catch (error) {
      setError(error instanceof Error ? error.message : t('modal.errors.urlPreviewFailed'));
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlPreview || !urlPreview.content) {
      setError(t('modal.errors.checkUrlPreview'));
      return;
    }

    // Create Library document directly using the same pipeline as file upload
    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch("/api/documents/create-from-url-library", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          url: url.trim(),
          title: title || urlPreview.title,
          author: urlPreview.author,
          sourceLanguage: sourceLanguage,
          
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('modal.errors.createDocFailed'));
      }

      const data = await response.json();

      // Navigate to library to see the newly created document
      window.location.href = `/library`;
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('modal.errors.createDocError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError(t('modal.errors.enterTitle'));
      return;
    }

    let finalContent = content.trim();

    // Handle URL mode separately
    if (inputMode === 'url') {
      return handleUrlSubmit();
    }

    if (inputMode === 'file' && file && !finalContent) {
      if (file.type !== 'text/plain') {
        setError(t('modal.errors.pdfDocxInfo'));
        // For non-text files, we'll use a placeholder that the server will replace
        finalContent = `[FILE_UPLOAD:${file.name}]`;
      }
    }

    if (!finalContent && inputMode === 'text') {
      setError(t('modal.errors.enterContent'));
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      if (inputMode === 'file' && file && file.type !== 'text/plain') {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", title.trim());
        formData.append("sourceLanguage", sourceLanguage);

        const token = localStorage.getItem('accessToken');
        const response = await fetch("/api/documents/upload", {
          method: "POST",
          headers: {
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          if (errorData.errorCode === "UPLOAD_LIMIT_REACHED") {
            setUpgradeType("upload");
            setIsSubmitting(false);
            return;
          }
          const errorMessage = errorData.error || errorData.details || t('modal.errors.uploadFailed');
          throw new Error(errorMessage);
        }

        const data = await response.json();
        // Redirect to library instead of viewer to avoid 404 if document is still processing
        window.location.href = `/library`;
      } else {
        await onSubmit(title.trim(), finalContent, sourceLanguage);
      }

      // Reset form after successful submission
      setTitle("");
      setContent("");
      setFile(null);
      setUrl("");
      setUrlPreview(null);
      setError(null);
      onClose();
    } catch (err) {
      if ((err as any)?.errorCode === "UPLOAD_LIMIT_REACHED") {
        setUpgradeType("upload");
        setIsSubmitting(false);
        return;
      }
      setError(err instanceof Error ? err.message : t('modal.errors.processingError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting && !isExtractingText) {
      handleFullClose();
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <FileText className="h-5 w-5 mr-2" />
            {t('modal.addNewDocument')}
          </DialogTitle>
          <DialogDescription>
            {t('modal.addDocumentDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Title Input */}
          <div className="space-y-2">
            <Label htmlFor="title">{t('modal.documentTitle')}</Label>
            <Input
              id="title"
              placeholder={t('modal.documentTitlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Input Mode Selection */}
          <div className="space-y-3">
            <Label>{t('modal.inputMethod')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={inputMode === 'text' ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => setInputMode('text')}
                disabled={isSubmitting || isExtractingText}
                data-testid="button-mode-text"
              >
                <Type className="h-4 w-4 mr-2" />
                {t('modal.textInput')}
              </Button>
              <Button
                type="button"
                variant={inputMode === 'file' ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => setInputMode('file')}
                disabled={isSubmitting || isExtractingText}
                data-testid="button-mode-file"
              >
                <Upload className="h-4 w-4 mr-2" />
                {t('modal.fileUpload')}
              </Button>
              <Button
                type="button"
                variant={inputMode === 'url' ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => setInputMode('url')}
                disabled={isSubmitting || isExtractingText}
                data-testid="button-mode-url"
              >
                <Globe className="h-4 w-4 mr-2" />
                {t('modal.urlImport')}
              </Button>
              <Button
                type="button"
                variant={inputMode === 'photo' ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => setInputMode('photo')}
                disabled={isSubmitting || isExtractingText}
                data-testid="button-mode-photo"
              >
                <Camera className="h-4 w-4 mr-2" />
                {t('ocr.photoImport')}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Content Input based on mode */}
          {inputMode === 'text' ? (
            <div className="space-y-2">
              <Label htmlFor="content">{t('modal.textContent')}</Label>
              <Textarea
                id="content"
                placeholder={t('modal.textContentPlaceholder')}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={isSubmitting}
                rows={12}
                className="min-h-[300px] resize-y"
              />
              <div className="text-xs text-muted-foreground">
                {t('modal.characterCount', { count: content.length })}
              </div>
            </div>
          ) : inputMode === 'file' ? (
            <div className="space-y-2">
              <Label htmlFor="file-upload">{t('modal.selectFile')}</Label>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                  "hover:bg-accent",
                  file ? "border-[#6B8E7E] bg-[#2F5D50]/5 dark:bg-[#2F5D50]/10" : "border-border"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf,.docx,.doc"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={isSubmitting}
                />
                {file ? (
                  <div className="space-y-2">
                    <FileText className="mx-auto h-8 w-8 text-[#2F5D50]" />
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {file.size < 1024 * 1024 
                        ? `${(file.size / 1024).toFixed(1)} KB`
                        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                      }
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">{t('modal.clickToSelect')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('modal.supportedFormats')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : inputMode === 'url' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url-input">{t('modal.webpageUrl')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="url-input"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isSubmitting || isLoadingPreview}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={handleUrlPreview}
                    disabled={!url.trim() || isSubmitting || isLoadingPreview}
                    variant="outline"
                  >
                    {isLoadingPreview ? (
                      <div className="flex items-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                        {t('modal.loading')}
                      </div>
                    ) : (
                      t('modal.preview')
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('modal.urlHint')}
                </p>
              </div>

              {urlPreview && (
                <div className="border rounded-lg p-4 bg-accent/50">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-[#2F5D50]" />
                      <span className="text-sm font-medium text-[#2F5D50]">{t('modal.previewSuccess')}</span>
                    </div>
                    <h4 className="font-medium">{urlPreview.title}</h4>
                    {urlPreview.author && (
                      <p className="text-sm text-muted-foreground">{t('modal.author')}: {urlPreview.author}</p>
                    )}
                    {urlPreview.source && (
                      <p className="text-sm text-muted-foreground">{t('modal.source')}: {urlPreview.source}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t('modal.textExtracted', { count: urlPreview.contentLength })}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Photo Import Mode */
            <div className="space-y-4">
              {isExtractingText ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Loader2 className="h-10 w-10 animate-spin" style={{ color: "#6B8E7E" }} />
                  <p className="text-sm text-muted-foreground">{t('ocr.processingDescription')}</p>
                </div>
              ) : !hasExtracted ? (
                <>
                  <div className="space-y-2">
                    <Label>{t('ocr.selectImages')}</Label>
                    <div
                      className={cn(
                        "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                        "hover:bg-accent",
                        photoImages.length >= MAX_IMAGES
                          ? "border-muted cursor-not-allowed opacity-50"
                          : "border-border"
                      )}
                      onClick={() => photoImages.length < MAX_IMAGES && photoInputRef.current?.click()}
                      data-testid="photo-import-dropzone"
                    >
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handlePhotoSelect}
                        className="hidden"
                        disabled={photoImages.length >= MAX_IMAGES || isSubmitting}
                      />
                      <div className="space-y-2">
                        <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium">{t('ocr.clickToSelect')}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('ocr.maxImages', { count: MAX_IMAGES })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('ocr.currentCount', { current: photoImages.length, max: MAX_IMAGES })}
                        </p>
                      </div>
                    </div>
                  </div>

                  {photoImages.length > 0 && (
                    <div className="space-y-2">
                      <Label>{t('ocr.selectedImages')}</Label>
                      <div className="grid grid-cols-2 gap-4">
                        {photoImages.map((img, index) => (
                          <div
                            key={index}
                            className="relative rounded-lg overflow-hidden border"
                          >
                            <img
                              src={img.preview}
                              alt={`Selected ${index + 1}`}
                              className="w-full h-32 object-cover"
                            />
                            <button
                              onClick={() => handleRemovePhoto(index)}
                              className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <Button
                        type="button"
                        onClick={handleExtractText}
                        disabled={photoImages.length === 0 || isExtractingText}
                        className="w-full mt-2"
                        data-testid="button-extract-text"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        {t('ocr.extractText')}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('ocr.sourceLanguage')}</Label>
                      <Select value={sourceLanguage} onValueChange={setSourceLanguage} disabled={isSubmitting}>
                        <SelectTrigger>
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
                    
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="extracted-text">{t('ocr.extractedText')}</Label>
                    <Textarea
                      id="extracted-text"
                      value={extractedText}
                      onChange={(e) => setExtractedText(e.target.value)}
                      disabled={isSubmitting}
                      rows={10}
                      className="min-h-[200px] resize-y font-mono text-sm"
                      placeholder={t('ocr.editPlaceholder')}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t('ocr.reviewHint')}</span>
                      <span>{t('ocr.characterCount', { count: extractedText.length })}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="space-y-2">
              <div className="flex items-start text-red-500 text-sm gap-1">
                <AlertCircle className="h-4 w-4 mr-1 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
              {errorCode === 'URL_ACCESS_BLOCKED' && (
                <button
                  type="button"
                  onClick={() => { setInputMode('text'); setError(null); setErrorCode(null); }}
                  className="text-sm text-[#2F5D50] underline hover:opacity-80"
                >
                  {t('modal.errors.switchToText')}
                </button>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="outline" onClick={handleClose} disabled={isSubmitting || isExtractingText} className="rounded-xl">
              {t('modal.cancel')}
            </Button>
            {inputMode === 'url' ? (
              <Button 
                variant="default"
                onClick={handleUrlSubmit} 
                disabled={!urlPreview || isSubmitting}
                className="bg-[#2F5D50] hover:bg-[#2F5D50]/90 rounded-xl"
              >
                {isSubmitting ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {t('modal.creatingDocument')}
                  </div>
                ) : (
                  t('modal.createDocument')
                )}
              </Button>
            ) : inputMode === 'photo' ? (
              hasExtracted ? (
                <Button 
                  variant="default"
                  onClick={handlePhotoSubmit} 
                  disabled={!title.trim() || !extractedText.trim() || isSubmitting}
                  data-testid="button-save-document"
                  className="bg-[#2F5D50] hover:bg-[#2F5D50]/90 rounded-xl"
                >
                  {isSubmitting ? (
                    <div className="flex items-center">
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('common.saving')}
                    </div>
                  ) : (
                    t('ocr.saveToLibrary')
                  )}
                </Button>
              ) : null
            ) : (
              <Button 
                variant="default"
                onClick={handleSubmit} 
                disabled={isSubmitting || !title.trim() || (inputMode === 'text' && !content.trim()) || (inputMode === 'file' && !file)}
                className="bg-[#2F5D50] hover:bg-[#2F5D50]/90 rounded-xl"
              >
                {isSubmitting ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {t('modal.processing')}
                  </div>
                ) : (
                  t('modal.createDocument')
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <UpgradePromptDialog
      isOpen={upgradeType !== null}
      onClose={() => setUpgradeType(null)}
      type={upgradeType || "upload"}
    />
    </>
  );
}
