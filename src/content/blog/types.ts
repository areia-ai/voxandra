export type BlogBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] }
  | { type: "quote"; text: string; attribution?: string }
  | {
      type: "image";
      src: string;
      alt: string;
      width: number;
      height: number;
      caption?: string;
    };

export interface BlogImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

// Data shape for a single blog post. Every field maps to one part of the
// shared template in blog-post-page.tsx — add a new post by writing one of
// these under src/content/blog/posts/ and registering it in posts.ts, not by
// touching the template.
//
// `status` is the actual publish gate: "draft" posts are excluded from
// /blog, sitemap.ts, and generateStaticParams, and get a noindex meta tag.
// Flipping a post to "published" is a deliberate, reviewed edit — see
// posts.ts.
export interface BlogPostData {
  slug: string;
  status: "draft" | "published";
  title: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  author: string;
  publishedDate: string;
  publishedDateISO: string;
  featuredImage?: BlogImage;
  updatedDate?: string;
  updatedDateISO?: string;
  body: BlogBlock[];
}
