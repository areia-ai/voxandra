---
name: new-blog-post
description: Research, draft, and iterate on a new Voxandra /blog post end to end — from a topic idea to a previewable draft file — and publish it (flip status to "published") only on the user's explicit sign-off. Use when the user wants to start a new blog post, write a draft for the blog, research a blog topic, or publish/flip an existing draft post live.
---

# New Blog Post

Runs the collaborative post workflow described in `AGENTS.md`'s "Blog Posts (SEO/GEO)"
section: turn a topic into a `BlogPostData` draft file, register it, preview it locally,
iterate with the user, and — only on explicit sign-off — flip it to published. Read that
AGENTS.md section first if you haven't; this skill is the mechanical steps, not a
restatement of the rules.

Every step below happens inside this repo (`voxandra`). The sibling `voxandra-marketing`
repo is read-only research material — never write to it from here.

## Step 1 — Pick the topic and ground the research

- If the user gave a topic, use it. If not, offer 2-3 options pulled from the "Good First
  Pages" backlog in `../voxandra-marketing/channels/seo/README.md`.
- Read `../voxandra-marketing/content/blog/brief-template.md` and fill it out mentally (or
  literally, if it helps you think) before drafting: Target query, Search intent, Audience,
  Angle, Product connection, Claims to verify, CTA. This is what keeps a post from becoming
  generic filler.
- Read the current dated product-truth snapshot under
  `../voxandra-marketing/positioning/` before treating Voice Translation, a translated demo,
  a supported language count, or any release state as public. Material marked internal only
  can inform private planning but must not appear as publicly available in a post.
- Read the rest of `../voxandra-marketing/channels/seo/README.md` for GEO guidance
  (freshness signals, citation-friendly structure, crawler behavior) to shape the draft.
- Cross-check every factual claim against files inside *this* repo before writing it:
  `src/lib/pricing.ts` for pricing, `AGENTS.md` for product positioning and IA rules, and
  `src/content/blog/posts.ts` for what's already been covered. Never invent customer
  counts, pricing, or feature claims that aren't already true and stated somewhere in this
  repo — the marketing repo's own draft rules say the same thing: verify prices, feature
  names, and plan details before publishing.

## Step 2 — Draft the post object

Create `src/content/blog/posts/<slug>.ts` (kebab-case slug derived from the working title),
shaped like `BlogPostData` in `src/content/blog/types.ts`:

```ts
import type { BlogPostData } from "../types";

export const <camelCaseName>: BlogPostData = {
  slug: "<slug>",
  status: "draft",
  title: "...",
  excerpt: "...",
  metaTitle: "...",        // no "| Voxandra" suffix — layout.tsx's title template adds it
  metaDescription: "...",
  author: "Voxandra Team",
  publishedDate: "<Month D, YYYY>",
  publishedDateISO: "<YYYY-MM-DD>",
  body: [
    { type: "paragraph", text: "..." },
    { type: "heading", text: "..." },
    { type: "list", items: ["...", "..."] },
    // "quote" and "image" blocks are also available; follow src/content/blog/types.ts.
  ],
};
```

Rules while drafting:

- Always `status: "draft"` at this stage — flipping to published is Step 5, and only on
  explicit sign-off.
- Work the canonical product sentence in verbatim, once, somewhere it reads naturally —
  never paraphrase it: "Voxandra is an AI platform for multilingual business calls. It
  translates both sides of live phone conversations, provides private guidance while people
  talk, and turns each call into a reviewed Call Record."
- Translation-first posts should link naturally to `/live-voice-translation` and present
  Guidance, bilingual transcripts, notes, reminders, contacts, and work threads as the
  complete system around a translated call. Preserve useful Call Record topics as downstream
  benefits rather than forcing every article into a generic translation pitch.
- `metaTitle` must NOT include "| Voxandra" — the root layout's title template already
  appends it (`%s | Voxandra`). Getting this wrong produces a doubled title tag.
- Keep body content in the typed block model (`paragraph` / `heading` / `list` / `quote`)
  — no MDX, no raw HTML strings, no client component wrapping any part of the body. Every
  block renders as plain server-rendered HTML through `blog-post-page.tsx`.

## Step 3 — Register it

Add the post to `src/content/blog/posts.ts`:

- Import the new export.
- Add it to the `allBlogPosts` array.

That's the only file that needs touching — `/blog`, `/blog/[slug]`, and `sitemap.ts` all
read from this registry, and a draft is correctly excluded from the first two and the
sitemap automatically.

## Step 4 — Preview and iterate

- Start the dev server and open `http://localhost:3000/blog/<slug>` — a draft renders at
  its real URL locally, just not linked from `/blog` or indexed.
- Confirm the body text is actually server-rendered, not just visible in the browser DOM:
  `curl -s http://localhost:3000/blog/<slug> | grep "<some body text>"`.
- Confirm the draft carries a noindex tag: `curl -s http://localhost:3000/blog/<slug> | grep 'name="robots"'` should show `noindex, nofollow`.
- Iterate with the user in conversation — rewrite `body` blocks, adjust
  title/excerpt/metadata — until they're happy. Re-run the curl checks after any edit that
  touches rendering.
- Before calling a draft done, run `npm run lint` and `npx tsc --noEmit`.

## Step 5 — Publish (only on explicit sign-off)

- Do not flip `status` to `"published"` unless the user clearly says the post is ready to
  go live. This is the actual sign-off mechanism, not a formality — treat it with the same
  care as any other deliberate, user-authorized change.
- Change only the `status` line — an isolated one-line diff, never bundled with unrelated
  changes. If this is a later edit to an already-published post rather than a new post,
  also set `updatedDate`/`updatedDateISO` (leave `publishedDate` alone).
- After flipping, confirm it shows up: `/blog` should list it, and
  `curl -s http://localhost:3000/sitemap.xml | grep <slug>` should find it.
- Do not commit, push, or deploy unless the user explicitly asks for that separately —
  flipping the status is a local file change. Going live on voxandra.com still depends on
  however this repo normally ships; see `AGENTS.md`'s "Git And Repo Hygiene" section.

## Notes

- One post per file, one backlog topic consumed at a time — don't batch-generate multiple
  posts speculatively just because the backlog has several entries.
- If the user asks what's already published or drafted, read `src/content/blog/posts.ts`
  directly rather than guessing from memory.
