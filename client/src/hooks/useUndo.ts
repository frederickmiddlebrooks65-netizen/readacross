import { useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface UndoOperation {
  type: 'move' | 'copy' | 'delete';
  execute: () => Promise<void>;
  description: string;
}

export const useUndo = () => {
  const { toast } = useToast();

  const createUndoableOperation = useCallback((
    operation: UndoOperation,
    undoTimeout = 7000 // 7 seconds
  ) => {
    let undoExecuted = false;
    let operationCancelled = false;

    // Show success toast first
    toast({
      title: 'Success',
      description: `${operation.description}. Click Undo within 7 seconds if you want to reverse this action.`
    });

    // Setup undo timeout
    const undoTimeoutId = setTimeout(() => {
      operationCancelled = true;
    }, undoTimeout);

    // Return undo function
    return {
      undo: async () => {
        if (undoExecuted || operationCancelled) return false;
        
        try {
          clearTimeout(undoTimeoutId);
          undoExecuted = true;
          await operation.execute();
          
          toast({
            title: 'Operation undone',
            description: 'The action has been successfully reversed'
          });
          return true;
        } catch (error) {
          console.error('Undo operation failed:', error);
          toast({
            title: 'Undo failed',
            description: 'Failed to undo the operation. Please try again.',
            variant: 'destructive'
          });
          return false;
        }
      }
    };
  }, [toast]);

  return {
    createUndoableOperation
  };
};