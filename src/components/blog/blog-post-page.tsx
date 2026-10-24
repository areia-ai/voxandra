import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Calendar, RefreshCw } from "lucide-react";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";
import { BlogPostingStructuredData } from "./blog-structured-data";
import type { BlogBlock, BlogPostData } from "@/content/blog/types";

function BlogBodyBlock({ block }: { block: BlogBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <h2 className="mt-10 text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          {block.text}
        </h2>
      );
    case "list":
      return (
        <ul className="mt-5 grid gap-3 rounded-2xl border border-stone-200 bg-white p-6 text-base leading-7 text-stone-600 shadow-sm">
          {block.items.map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6d28d9]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="mt-6 border-l-4 border-[#6d28d9]/40 pl-5 text-lg italic leading-8 text-stone-700">
          {block.text}
          {block.attribution && (
            <footer className="mt-2 text-sm not-italic font-semibold text-stone-500">
              {block.attribution}
            </footer>
          )}
        </blockquote>
      );
    case "image":
      return (
        <figure className="mt-8">
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <Image
              src={block.src}
              alt={block.alt}
              width={block.width}
              height={block.height}
              sizes="(min-width: 768px) 704px, calc(100vw - 40px)"
              className="h-auto w-full"
            />
          </div>
          {block.caption && (
            <figcaption className="mt-3 text-sm leading-6 text-stone-500">
              {block.caption}
            </figcaption>
          )}
        </figure>
      );
    case "paragraph":
    default:
      return <p className="mt-5 text-base leading-7 text-stone-600">{block.text}</p>;
  }
}

// Shared shell for every blog post. A new post only needs a new
// BlogPostData object under content/blog/posts/ — this template stays
// untouched.
export function BlogPostPage({ data }: { data: BlogPostData }) {
  return (
    <main className="min-h-screen overflow-hidden bg-[#faf8f4] text-stone-950">
      <div className="bg-[radial-gradient(circle_at_75%_12%,rgba(124,58,237,0.12),transparent_34%),linear-gradient(180deg,#fffaf4_0%,#faf8f4_62%,#faf8f4_100%)]">
        <LandingHeader />

        <article className="mx-auto max-w-3xl px-5 pb-14 pt-4 md:px-8 md:pb-16 md:pt-8">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Back to blog
          </Link>

          <h1 className="mt-5 text-4xl font-bold leading-tight text-stone-950 md:text-5xl">
            {data.title}
          </h1>

          <p className="mt-5 text-lg leading-8 text-stone-600">{data.excerpt}</p>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs font-semibold text-stone-600">
            <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-1.5 shadow-sm">
              <Calendar aria-hidden="true" className="h-3.5 w-3.5 text-[#6d28d9]" />
              Published {data.publishedDate}
            </span>
            {data.updatedDate && (
              <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-1.5 shadow-sm">
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 text-[#6d28d9]" />
                Updated {data.updatedDate}
              </span>
            )}
            <span className="inline-flex items-center rounded-full border border-stone-200 bg-white px-4 py-1.5 shadow-sm">
              {data.author}
            </span>
          </div>

          {data.featuredImage && (
            <div className="mt-8 overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white shadow-lg shadow-stone-900/5">
              <Image
                src={data.featuredImage.src}
                alt={data.featuredImage.alt}
                width={data.featuredImage.width}
                height={data.featuredImage.height}
                sizes="(min-width: 768px) 704px, calc(100vw - 40px)"
                priority
                className="h-auto w-full"
              />
            </div>
          )}

          <div className="mt-10">
            {data.body.map((block, index) => (
              <BlogBodyBlock key={`${block.type}-${index}`} block={block} />
            ))}
          </div>
        </article>
      </div>

      <section className="px-5 pb-16 md:px-8 lg:pb-20">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-[2rem] bg-[#3b1676] p-8 text-center text-white shadow-2xl shadow-violet-950/20 md:p-12">
          <h2 className="text-3xl font-semibold leading-tight md:text-4xl">
            Make the call. Review the record.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-violet-100 md:text-lg">
            See how Voxandra turns a live browser call into an AI note, follow-ups,
            contacts, and a work thread your team can use.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/login?redirect=/app/dialer"
              className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-[#2e1065] shadow-lg shadow-violet-950/20 transition hover:bg-[#fff7ed]"
            >
              Try the free call
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
      <BlogPostingStructuredData data={data} />
    </main>
  );
}
