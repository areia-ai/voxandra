import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogPostPage } from "@/components/blog/blog-post-page";
import { getPostBySlug, getPublishedPosts } from "@/content/blog/posts";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Only published posts get pre-rendered/linked from generateStaticParams.
// Draft posts are NOT in this list, but dynamicParams defaults to true, so a
// draft's real URL still renders on request in dev/preview for review —
// it's just never pre-built, never in the sitemap, and never linked from
// /blog.
export function generateStaticParams() {
  return getPublishedPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return {};
  }

  const isPublished = post.status === "published";

  return {
    title: post.metaTitle,
    description: post.metaDescription,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      title: post.metaTitle,
      description: post.metaDescription,
      type: "article",
      publishedTime: post.publishedDateISO,
      modifiedTime: post.updatedDateISO ?? post.publishedDateISO,
    },
    twitter: {
      title: post.metaTitle,
      description: post.metaDescription,
    },
    // Draft posts are previewable at their real URL but must never be
    // indexed or crawled — this is the noindex gate for anything that
    // isn't "published" yet.
    robots: isPublished
      ? undefined
      : { index: false, follow: false },
  };
}

export default async function BlogPostRoute({ params }: PageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  return <BlogPostPage data={post} />;
}
