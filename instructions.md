

# ReadAcross Service Strategy (Beta → Paid Launch)

## 1. Strategic Positioning

ReadAcross is not a generic translator.
It is positioned as:

> A document-based AI reading & translation workspace for serious readers.

Primary initial target:
- Graduate students
- Researchers reading academic papers
- Knowledge workers reading long-form English documents

This positioning justifies a higher price point than simple “text translators.”

---

## 2. Launch Strategy (3-Phase Model)

### Phase 1 — Controlled Beta (30 users max)

Goal:
- Measure real AI usage (token consumption)
- Identify heavy-user patterns
- Validate feature differentiation

Constraints:
- Invite-only
- Usage tracking enabled
- Hard monthly token cap (see section 4)

No marketing push yet.
Focus: usage data collection.

---

### Phase 2 — Early Paid Validation

Goal:
- Convert 5–10 users to paid Pro
- Validate willingness to pay ₩14,900/month

Maintain token caps.
Do NOT offer unlimited usage.

---

### Phase 3 — Public Launch

Only after:
- Average monthly token usage known
- Heavy user outliers understood
- Cost per user modeled
- Infrastructure stable

---

## 3. Cost Structure Analysis

### 3.1 Primary Cost Drivers

1. Gemini API (largest variable cost)
   - Translation
   - Coaching
   - Summary
   - Quiz generation
   - OCR
   - Language detection

2. Database (Neon / PostgreSQL)
   - User data
   - Document storage
   - Sentence-level storage
   - Quiz & notes

3. Object Storage
   - Uploaded documents
   - Thumbnails
   - Assets

4. Email (Resend)

5. Server hosting (Replit)

Gemini API is the dominant risk factor.

---

## 4. Token-Based Safety Architecture

### Why Token-Based Limits?

Call-count limits do NOT protect cost.

Example:
- 1 small sentence = 500 tokens
- 1 long academic batch = 40,000+ tokens

Both count as “1 call.”

Therefore:
Token usage must be tracked per user.

---

## 5. Conversion-Oriented Plan Design

The goal is not feature differentiation by model,
but workflow differentiation by depth of use.

Starter = Exploration  
Pro = Sustainable workflow

Model differentiation exists (Lite vs 2.5 Flash),
but conversion is primarily driven by workflow depth,
not by model branding.

---

### Starter (Free – Exploration Plan)

Purpose:
- Experience AI reading
- Test 1–2 documents
- Light experimentation

Limits:

- Monthly token cap: 50,000
- Concurrent document storage: up to 3 documents
- Full-document translation: 3 times per month
- OCR: 3 times per month
- AI coaching: token-based (within monthly cap)
- Premium model: not available (gemini-2.0-flash-lite)
- Export/download: not available

Design intention:

Starter provides strong basic AI reading capability,
but is intentionally limited for sustained academic workflow.

It is suitable for light reading and experimentation,
but not for continuous research usage.

---

### Pro (₩14,900 / month, ₩9,900 annual equivalent)

Purpose:
- Ongoing academic or professional reading
- Full AI-assisted document workflow

Features:

- Monthly token cap: 500,000
- Premium model usage capped at 200,000 tokens
- Automatic fallback to flash-lite after premium cap
- Unlimited document storage (within token cap)
- Unlimited full-document translation (within token cap)
- Unlimited OCR (within token cap)
- Unlimited quiz and summary generation
- Export/download enabled
- Persistent document history
- Priority processing
- Advanced AI model (gemini-2.5-flash)

Design intention:

Pro is not merely “better AI.”
It completes the academic reading workflow with higher-quality AI reasoning and sustained usage capacity.

---

### Upgrade Triggers (Conversion Mechanisms)

Upgrade prompts should appear when:

- User attempts to upload a 4th document
- User attempts a 3rd full-document translation
- User tries to export/download
- User reaches 80% of monthly token usage
- User attempts additional OCR beyond limit

Conversion must be triggered by workflow interruption,
not by abstract model comparison.

---

## 6. Free Plan Strategy Decision

There are two strategic models:

1. Permanent Free Plan (Freemium)
   - Starter always available
   - Drives continuous top-of-funnel growth
   - Lower immediate revenue conversion
   - Strong long-term brand expansion

2. Time-Limited Free Trial
   - All Pro features for 7–14 days
   - Then paywall
   - Higher early conversion rate
   - Slower organic user growth

For ReadAcross (early-stage AI SaaS):

Recommended:
Start with Permanent Starter (Freemium) during beta phase.
Re-evaluate after 3–6 months of usage data.

Freemium helps collect behavioral data.
Free trial helps optimize monetization.

Data should determine the final choice.

## 7. Critical Requirement Before Public Launch

Implement:

- Per-user monthly token tracking
- Automatic token accumulation after every Gemini response
- Hard stop when monthly cap exceeded
- Admin dashboard for:
  - Total token usage
  - Per-user usage
  - Daily aggregate cost estimate

Without this:
Financial risk is uncontrolled.

---

## 8. Financial Risk Modeling (Initial Assumptions)

Example scenario:

If average Pro user consumes:
- 150,000 tokens/month

And Gemini cost per million tokens = X (insert actual pricing)

Estimated cost per user:
= 0.15 × X

If this cost approaches ₩14,900,
pricing must be adjusted OR caps lowered.

Beta phase is for discovering this number.

---

## 9. Operational Stability Requirements

Before scaling:

- Error logging
- Rate limiting
- Storage cleanup policy
- Archive inactive documents
- Monitor server memory usage
- RSS/arXiv crawling frequency optimization

---

## 10. Strategic Priority Order

1. Token tracking implementation
2. Beta cohort recruitment (30 users)
3. Usage data analysis (1 month)
4. Adjust caps or pricing
5. Public launch

---

## 11. Core Principle

Never offer unlimited AI usage in early-stage AI SaaS.

Unlimited = unpredictable cost.
Predictability = survival.

ReadAcross must prioritize sustainability over rapid growth.