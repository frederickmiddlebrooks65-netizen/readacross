import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: "default" | "destructive";
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "확인",
  cancelLabel = "취소",
  onConfirm,
  variant = "default",
}: ConfirmDialogProps) {
  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="sm:max-w-[400px] rounded-xl border-border/50 shadow-xl"
        onClick={stopPropagation}
        onMouseDown={stopPropagation}
        onPointerDown={stopPropagation}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold text-foreground">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel
            className="rounded-lg text-sm"
            onClick={stopPropagation}
            onMouseDown={stopPropagation}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onConfirm();
            }}
            onMouseDown={stopPropagation}
            className={cn(
              "rounded-lg text-sm",
              variant === "destructive" &&
                "bg-red-500/90 hover:bg-red-500 text-white border-0"
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
