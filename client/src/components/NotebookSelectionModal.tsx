import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Plus } from 'lucide-react';
import { NotebookBadge } from '@/components/ui/NotebookBadge';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface Notebook {
  id: number;
  title: string;
  description: string | null;
  colorLabel: string | null;
  sentenceCount?: number;
}

interface NotebookSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (notebookId: number, notebookTitle: string) => void;
  title: string;
  description?: string;
  currentNotebookId?: number; // To exclude current notebook from list
  recentlyUsed?: number[]; // Recently used notebook IDs
}

export default function NotebookSelectionModal({
  isOpen,
  onClose,
  onSelect,
  title,
  description,
  currentNotebookId,
  recentlyUsed = []
}: NotebookSelectionModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newNotebookTitle, setNewNotebookTitle] = useState('');
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get all notebooks
  const { data: notebooks = [] } = useQuery<Notebook[]>({
    queryKey: ['/api/notebooks'],
    enabled: isOpen
  });

  // Create new notebook mutation
  const createNotebookMutation = useMutation({
    mutationFn: async (title: string) => {
      return apiRequest('/api/notebooks', {
        method: 'POST',
        json: { title, description: null, tags: null, isPublic: false }
      });
    },
    onSuccess: (newNotebook) => {
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      onSelect(newNotebook.id, newNotebook.title);
      setShowCreateNew(false);
      setNewNotebookTitle('');
      onClose();
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to create notebook',
        variant: 'destructive'
      });
    }
  });

  // Filter and sort notebooks
  const filteredNotebooks = notebooks
    .filter(notebook => 
      notebook.id !== currentNotebookId && // Exclude current notebook
      (searchQuery === '' || 
       notebook.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
       notebook.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    )
    .sort((a, b) => {
      // Sort by recently used first
      const aRecent = recentlyUsed.indexOf(a.id);
      const bRecent = recentlyUsed.indexOf(b.id);
      
      if (aRecent !== -1 && bRecent !== -1) {
        return aRecent - bRecent; // Earlier index = more recent
      }
      if (aRecent !== -1) return -1; // a is recent, b is not
      if (bRecent !== -1) return 1;  // b is recent, a is not
      
      // Both not recent, sort alphabetically
      return a.title.localeCompare(b.title);
    });

  // Get recently used notebooks (top 3-5)
  const recentNotebooks = filteredNotebooks.filter(nb => recentlyUsed.includes(nb.id)).slice(0, 5);
  const otherNotebooks = filteredNotebooks.filter(nb => !recentlyUsed.includes(nb.id));

  const handleCreateNew = () => {
    if (!newNotebookTitle.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a notebook title',
        variant: 'destructive'
      });
      return;
    }
    createNotebookMutation.mutate(newNotebookTitle.trim());
  };

  const handleNotebookSelect = (notebook: Notebook) => {
    onSelect(notebook.id, notebook.title);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Create New Notebook - Compact */}
          {showCreateNew ? (
            <div className="flex gap-2">
              <Input
                placeholder="New notebook name..."
                value={newNotebookTitle}
                onChange={(e) => setNewNotebookTitle(e.target.value)}
                className="flex-1"
                onKeyPress={(e) => e.key === 'Enter' && handleCreateNew()}
                autoFocus
              />
              <Button 
                size="sm" 
                onClick={handleCreateNew}
                disabled={createNotebookMutation.isPending}
              >
                {createNotebookMutation.isPending ? '...' : 'Create'}
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={() => {
                  setShowCreateNew(false);
                  setNewNotebookTitle('');
                }}
              >
                ×
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateNew(true)}
              className="w-full flex items-center gap-2 py-2 px-3 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New notebook</span>
            </button>
          )}

          {/* Notebooks List - Simplified */}
          <div className="max-h-64 overflow-y-auto -mx-2 px-2">
            {filteredNotebooks.map((notebook) => (
              <button
                key={notebook.id}
                onClick={() => handleNotebookSelect(notebook)}
                className="w-full flex items-center justify-between gap-3 py-2.5 px-3 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-left transition-colors"
              >
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {notebook.title}
                </span>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {notebook.sentenceCount || 0}
                </span>
              </button>
            ))}

            {/* Empty State */}
            {filteredNotebooks.length === 0 && (
              <div className="text-center py-6 text-gray-500 text-sm">
                No notebooks available
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}