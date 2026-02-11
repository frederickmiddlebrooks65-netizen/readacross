
import { db } from "./db.js";
import { documents } from "../shared/schema.js";
import { sql, eq } from "drizzle-orm";

async function debugDatabase() {
  console.log("=== 데이터베이스 문서 현황 ===\n");
  
  // 전체 문서 개수
  const totalDocs = await db.select({ count: sql`count(*)` }).from(documents);
  console.log(`전체 문서 개수: ${totalDocs[0].count}\n`);
  
  // 카테고리별 분포
  console.log("=== 카테고리별 분포 ===");
  const categoryStats = await db
    .select({ 
      category: documents.category, 
      count: sql`count(*)` 
    })
    .from(documents)
    .groupBy(documents.category);
  
  categoryStats.forEach(stat => {
    console.log(`${stat.category || 'NULL'}: ${stat.count}개`);
  });
  
  // Public vs Private 분포
  console.log("\n=== Public/Private 분포 ===");
  const publicStats = await db
    .select({ 
      isPublic: documents.isPublic, 
      count: sql`count(*)` 
    })
    .from(documents)
    .groupBy(documents.isPublic);
  
  publicStats.forEach(stat => {
    console.log(`${stat.isPublic ? 'Public' : 'Private'}: ${stat.count}개`);
  });
  
  // Source별 분포
  console.log("\n=== Source별 분포 ===");
  const sourceStats = await db
    .select({ 
      source: documents.source, 
      count: sql`count(*)` 
    })
    .from(documents)
    .groupBy(documents.source);
  
  sourceStats.forEach(stat => {
    console.log(`${stat.source || 'NULL'}: ${stat.count}개`);
  });
  
  // 샘플 문서들 (처음 10개)
  console.log("\n=== 샘플 문서들 ===");
  const sampleDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      category: documents.category,
      source: documents.source,
      isPublic: documents.isPublic,
      author: documents.author
    })
    .from(documents)
    .limit(10);
  
  sampleDocs.forEach(doc => {
    console.log(`ID: ${doc.id} | Title: ${doc.title} | Category: ${doc.category} | Source: ${doc.source} | Public: ${doc.isPublic} | Author: ${doc.author}`);
  });
  
  // Update existing categories to English
  console.log("\n=== 카테고리 업데이트 ===");
  
  // Update classic -> Literature
  const classicUpdate = await db
    .update(documents)
    .set({ category: 'Literature' })
    .where(eq(documents.category, 'classic'))
    .returning({ id: documents.id });
  
  // Update science -> Academic (or Educational based on content)
  const scienceUpdate = await db
    .update(documents)
    .set({ category: 'Academic' })
    .where(eq(documents.category, 'science'))
    .returning({ id: documents.id });
  
  console.log(`Updated ${classicUpdate.length} classic documents to Literature`);
  console.log(`Updated ${scienceUpdate.length} science documents to Academic`);
  
  process.exit(0);
}

debugDatabase().catch(console.error);
