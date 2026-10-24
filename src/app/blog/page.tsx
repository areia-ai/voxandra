import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Calendar } from "lucide-react";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";
import { BlogIndexStructuredData } from "@/components/blog/blog-structured-data";
import { getPublishedPosts } from "@/content/blog/posts";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical writing on multilingual business calls, live voice translation, and reviewed Call Records.",
  alternates: {
    canonical: "/blog",
  },
  openGraph: {
    title: "Voxandra Blog",
    description:
      "Practical writing on multilingual business calls, live voice translation, and reviewed Call Records.",
  },
  twitter: {
    title: "Voxandra Blog",
    description:
      "Practical writing on multilingual business calls, live voice translation, and reviewed Call Records.",
  },
};

export default function BlogIndexPage() {
  const posts = getPublishedPosts();

  return (
    <main className="min-h-screen overflow-hidden bg-[#faf8f4] text-stone-950">
      <div className="bg-[radial-gradient(circle_at_75%_12%,rgba(124,58,237,0.12),transparent_34%),linear-gradient(180deg,#fffaf4_0%,#faf8f4_62%,#faf8f4_100%)]">
        <LandingHeader />

        <section className="mx-auto max-w-4xl px-5 pb-12 pt-4 md:px-8 md:pb-16 md:pt-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#6d28d9]">Blog</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-stone-950 md:text-5xl">
            Notes on calls, done right
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600">
            Voxandra translates multilingual business calls and turns them into
            reviewed call records: AI notes, transcripts, extracted details, reminders,
            contacts, and work threads.
          </p>
        </section>
      </div>

      <section className="mx-auto max-w-4xl px-5 pb-16 md:px-8 md:pb-20">
        {posts.length === 0 ? (
          <p className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-base leading-7 text-stone-500 shadow-sm">
            No posts yet — check back soon.
          </p>
        ) : (
          <div className="grid gap-5">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group rounded-2xl border border-stone-200 bg-white p-6 shadow-sm transition hover:border-[#6d28d9]/30 hover:shadow-md md:p-7"
              >
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-stone-500">
                  <Calendar aria-hidden="true" className="h-3.5 w-3.5 text-[#6d28d9]" />
                  Published {post.publishedDate}
                  {post.updatedDate && ` · Updated ${post.updatedDate}`}
                </span>
                <h2 className="mt-3 text-2xl font-semibold leading-tight text-stone-950">
                  {post.title}
                </h2>
                <p className="mt-3 text-base leading-7 text-stone-600">{post.excerpt}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#2e1065] transition group-hover:text-[#6d28d9]">
                  Read the post
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <LandingFooter />
      <BlogIndexStructuredData posts={posts} />
    </main>
  );
}
