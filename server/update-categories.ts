
import { db } from "./db";
import { documents } from "@shared/schema";
import { eq, or } from "drizzle-orm";

async function updateCategoriesToEnglish() {
  console.log("Starting category update to English...");
  
  try {
    // Update Korean categories to English
    const updates = [
      { from: '뉴스', to: 'News' },
      { from: '문학', to: 'Literature' },
      { from: '논문', to: 'Academic' },
      { from: '에세이/오피니언', to: 'Opinion' },
      { from: '칼럼·에세이', to: 'Opinion' },
      { from: '교육', to: 'Educational' },
      { from: '기타', to: 'Other' },
      { from: 'classic', to: 'Literature' },
      { from: 'science', to: 'Academic' },
      { from: 'Non-fiction', to: 'Opinion' },
    ];

    let totalUpdated = 0;

    for (const update of updates) {
      const result = await db
        .update(documents)
        .set({ category: update.to })
        .where(eq(documents.category, update.from))
        .returning({ id: documents.id });

      console.log(`Updated ${result.length} documents from '${update.from}' to '${update.to}'`);
      totalUpdated += result.length;
    }

    console.log(`Total documents updated: ${totalUpdated}`);
  } catch (error) {
    console.error("Error updating categories:", error);
  }
}

// Run the update if this file is executed directly
if (require.main === module) {
  updateCategoriesToEnglish().then(() => {
    console.log("Category update completed");
    process.exit(0);
  });
}

export { updateCategoriesToEnglish };
