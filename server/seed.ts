import { db } from "./db";
import { users, documents, paragraphs, sentences } from "@shared/schema";
import { storage } from "./storage";
import { seedGutenbergBooks } from "./gutenbergCrawler.js";
import { seedArxivPapers } from "./arxivCrawler.js";
import { hashPassword } from "./auth";

export async function seedDatabase() {
  try {
    // Check if we already have data
    const existingDocs = await db.select({ count: documents.id }).from(documents);
    
    if (existingDocs.length > 0 && existingDocs[0].count) {
      console.log("[seed] Database already has documents, skipping seed");
      return;
    }
    
    console.log("[seed] Starting to seed database...");
    
    // Create a sample user with hashed password
    const hashedPassword = await hashPassword("password");
    const [user] = await db.insert(users).values({
      username: "demo",
      password: hashedPassword
    }).returning();
    
    console.log(`[seed] Created demo user with id: ${user.id}`);
    
    // Sample documents data
    const sampleDocuments = [
      {
        title: "Modern AI Applications in Healthcare",
        sourceLanguage: "en",
        progress: 75,
      },
      {
        title: "Introduction to Neural Networks",
        sourceLanguage: "en",
        progress: 30,
      },
      {
        title: "The Future of Sustainable Energy",
        sourceLanguage: "en",
        progress: 100,
      },
    ];
    
    for (const doc of sampleDocuments) {
      // Create document
      const [document] = await db.insert(documents).values({
        title: doc.title,
        sourceLanguage: doc.sourceLanguage,
        userId: user.id,
        progress: doc.progress,
        category: "Academic" as const // Default category for sample documents
      }).returning();
      
      console.log(`[seed] Created document: ${document.title} with id: ${document.id}`);
      
      // Create paragraphs
      const [paragraph1] = await db.insert(paragraphs).values({
        documentId: document.id,
        order: 0,
        title: "Introduction"
      }).returning();
      
      const [paragraph2] = await db.insert(paragraphs).values({
        documentId: document.id,
        order: 1,
        title: "Current Applications"
      }).returning();
      
      // Add sentences to paragraph 1
      if (document.id === 1) {
        const sampleSentences1 = [
          {
            source: "Artificial intelligence (AI) has emerged as a transformative force in healthcare, offering unprecedented opportunities to improve patient outcomes, reduce costs, and enhance the efficiency of healthcare delivery systems.",
            target: "인공지능(AI)은 의료 분야에서 변혁적인 힘으로 등장하여, 환자 결과를 개선하고, 비용을 절감하며, 의료 전달 시스템의 효율성을 향상시킬 수 있는 전례 없는 기회를 제공하고 있습니다.",
            isScrapped: false,
            note: null
          },
          {
            source: "From diagnostic tools powered by machine learning to predictive analytics for patient monitoring, the applications of AI in healthcare are vast and continue to expand as technology evolves.",
            target: "기계 학습으로 구동되는 진단 도구부터 환자 모니터링을 위한 예측 분석에 이르기까지, 의료 분야에서의 AI 응용 프로그램은 기술이 발전함에 따라 방대하고 계속 확장되고 있습니다.",
            isScrapped: false,
            note: "'응용 프로그램'보다는 '적용 사례'가 더 자연스러운 표현일 것 같음."
          },
          {
            source: "This paper explores the current landscape of AI applications in healthcare, examining both the existing implementations and the potential future developments that could revolutionize healthcare practices.",
            target: "이 논문은 의료 분야에서 AI 응용의 현재 상황을 탐구하며, 의료 관행을 혁신할 수 있는 기존 구현과 잠재적 미래 발전 모두를 검토합니다.",
            isScrapped: true,
            note: null
          }
        ];
        
        // Add to paragraph 1
        for (let i = 0; i < sampleSentences1.length; i++) {
          const sentence = sampleSentences1[i];
          await db.insert(sentences).values({
            paragraphId: paragraph1.id,
            order: i,
            source: sentence.source,
            target: sentence.target,
            isScrapped: sentence.isScrapped,
            note: sentence.note
          });
        }
        
        // Add to paragraph 2
        const sampleSentences2 = [
          {
            source: "The integration of AI in healthcare has already produced remarkable results in several key areas.",
            target: "의료 분야에서 AI의 통합은 이미 여러 핵심 영역에서 주목할 만한 결과를 가져왔습니다.",
            isScrapped: false,
            note: null
          },
          {
            source: "Medical imaging analysis has been significantly enhanced by deep learning algorithms, which can detect subtle patterns in radiographic images that might be missed by human radiologists.",
            target: "의료 영상 분석은 인간 방사선 전문의가 놓칠 수 있는 방사선 영상의 미묘한 패턴을 감지할 수 있는 딥 러닝 알고리즘에 의해 크게 향상되었습니다.",
            isScrapped: false,
            note: null
          },
          {
            source: "Natural language processing (NLP) tools are being employed to analyze clinical notes, extract relevant information from medical literature, and improve the accuracy of electronic health records.",
            target: "자연어 처리(NLP) 도구는 임상 노트를 분석하고, 의학 문헌에서 관련 정보를 추출하며, 전자 건강 기록의 정확성을 향상시키는 데 사용되고 있습니다.",
            isScrapped: false,
            note: null
          }
        ];
        
        for (let i = 0; i < sampleSentences2.length; i++) {
          const sentence = sampleSentences2[i];
          await db.insert(sentences).values({
            paragraphId: paragraph2.id,
            order: i,
            source: sentence.source,
            target: sentence.target,
            isScrapped: sentence.isScrapped,
            note: sentence.note
          });
        }
      } else {
        // Add basic sentences for other documents
        const basicSentences1 = [
          { 
            source: "This is the first sentence of the introduction.", 
            target: "이것은 소개의 첫 번째 문장입니다." 
          },
          { 
            source: "This is the second sentence of the introduction.", 
            target: "이것은 소개의 두 번째 문장입니다." 
          }
        ];
        
        for (let i = 0; i < basicSentences1.length; i++) {
          const sentence = basicSentences1[i];
          await db.insert(sentences).values({
            paragraphId: paragraph1.id,
            order: i,
            source: sentence.source,
            target: sentence.target,
            isScrapped: false,
            note: null
          });
        }
        
        const basicSentences2 = [
          { 
            source: "This is the first sentence of the main content.", 
            target: "이것은 본문의 첫 번째 문장입니다." 
          },
          { 
            source: "This is the second sentence of the main content.", 
            target: "이것은 본문의 두 번째 문장입니다." 
          }
        ];
        
        for (let i = 0; i < basicSentences2.length; i++) {
          const sentence = basicSentences2[i];
          await db.insert(sentences).values({
            paragraphId: paragraph2.id,
            order: i,
            source: sentence.source,
            target: sentence.target,
            isScrapped: false,
            note: null
          });
        }
      }
    }
    
    console.log("[seed] Database seeding completed successfully");
  } catch (error) {
    console.error("[seed] Error seeding database:", error);
  }
}

export async function seedPublicLibrary() {
  try {
    console.log("[seed] Starting public library seeding...");
    
    // Guardian crawler removed - no longer used
    console.log("[seed] Guardian crawler removed, skipping Guardian articles.");
    
    // Seed other sources
    console.log("[seed] Seeding Gutenberg books...");
    await seedGutenbergBooks();
    
    // arXiv automatic seeding is intentionally disabled.
    // URL-based arXiv imports remain available via the generic URL importer.
    console.log("[seed] arXiv automatic seeding skipped (disabled)");
    
    console.log("[seed] Public library seeding completed successfully");
  } catch (error) {
    console.error("[seed] Error seeding public library:", error);
  }
}