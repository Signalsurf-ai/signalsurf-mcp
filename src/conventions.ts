// Ported from the internal Surfer system prompt
// (SignalsurfWeb/supabase/functions/_shared/pipeline/brain-analyze.ts:668-674)
// so external agents fill columns by the same rules.
export const FIELD_CONVENTIONS = `Field conventions (apply when filling columns):
- Website field: use a standalone domain homepage OR a profile page URL, never a single post/article URL.
- profile_url for creators: construct deterministically from the handle (Instagram: https://instagram.com/<handle>, TikTok: https://www.tiktok.com/@<handle>). Do not copy it from a signal payload.
- Image/logo/avatar: do not invent an image field. If the schema declares one, fill it from an enrichment result or leave it null for the cache job to derive.
- Free-text array/tag fields: normalize values to lowercase, dash-not-space, singular form. Reuse existing values (see popularValues) instead of inventing near-duplicates.
- Stable identifiers for dedup: post URL for posts, lowercase brand name for brands, handle for creators.`
