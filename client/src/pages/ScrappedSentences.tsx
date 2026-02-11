import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { DocumentWithParagraphs, LibraryDocument, SentenceWithUserData } from "@/lib/types.d";

// Extended Sentence type with document title
interface ScrappedSentence extends SentenceWithUserData {
  documentTitle?: string;
}

export default function ScrappedSentences() {
  const { toast } = useToast();
  const [scrappedSentences, setScrappedSentences] = useState<ScrappedSentence[]>([]);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);

  // Fetch all documents
  const { data: documentsData, isLoading: isLoadingDocuments } = useQuery({
    queryKey: ["/api/documents"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Function to fetch scrapped sentences per document
  const fetchScrappedSentences = async (documentId: number) => {
    try {
      const document = await apiRequest<DocumentWithParagraphs>('GET', `/api/documents/${documentId}`);
      
      // Find all scrapped sentences
      const scrapped: ScrappedSentence[] = [];
      document.paragraphs.forEach((paragraph) => {
        paragraph.sentences.forEach((sentence) => {
          if (sentence.isScrapped) {
            scrapped.push({
              ...sentence,
              // Add document title for context
              documentTitle: document.title
            });
          }
        });
      });
      
      return scrapped;
    } catch (error) {
      console.error(`Error fetching scrapped sentences for document ${documentId}:`, error);
      return [];
    }
  };

  useEffect(() => {
    if (documentsData) {
      setDocuments(documentsData as LibraryDocument[]);
      
      // Fetch scrapped sentences for all documents
      const fetchAllScrappedSentences = async () => {
        const allScrappedPromises = (documentsData as LibraryDocument[]).map(doc => 
          fetchScrappedSentences(doc.id)
        );
        
        try {
          const results = await Promise.all(allScrappedPromises);
          const allScrapped = results.flat();
          setScrappedSentences(allScrapped);
        } catch (error) {
          console.error("Error fetching scrapped sentences:", error);
          toast({
            title: "Error",
            description: "Failed to load scrapped sentences",
            variant: "destructive",
          });
        }
      };
      
      fetchAllScrappedSentences();
    }
  }, [documentsData, toast]);

  return (
    <Layout>
      <div className="container mx-auto p-4 mt-4">
        <h2 className="text-2xl font-bold mb-6">Scrapped Sentences</h2>
        
        {isLoadingDocuments ? (
          <p>Loading scrapped sentences...</p>
        ) : scrappedSentences.length === 0 ? (
          <p>You haven't scrapped any sentences yet. Mark sentences as scrapped in the document viewer.</p>
        ) : (
          <div className="grid gap-4">
            {scrappedSentences.map(sentence => (
              <Card key={sentence.id} className="border border-gray-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-gray-500">
                    From: {sentence.documentTitle || "Unknown document"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-2">
                    <p className="font-medium">{sentence.source}</p>
                  </div>
                  {sentence.target && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-gray-600">{sentence.target}</p>
                    </div>
                  )}
                  {(sentence as any).noteContent && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-sm italic text-gray-500">Note: {(sentence as any).noteContent}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}