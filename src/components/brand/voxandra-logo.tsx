import Image from "next/image";
import Link from "next/link";

type VoxandraLogoProps = {
  href?: string;
  variant?: "full" | "mark";
  tone?: "light" | "dark";
  className?: string;
  markClassName?: string;
  showTagline?: boolean;
  tagline?: string;
};

export function VoxandraLogo({
  href,
  variant = "full",
  tone = "light",
  className = "",
  markClassName = "",
  showTagline = false,
  tagline = "Multilingual business calls",
}: VoxandraLogoProps) {
  const taglineColor = tone === "dark" ? "text-violet-200" : "text-stone-500";
  const wordmarkColor = tone === "dark" ? "text-violet-100" : "text-[#3b1676] dark:text-violet-200";

  const content =
    variant === "mark" ? (
      <Image
        src="/brand/voxandra-mark.svg"
        alt="Voxandra"
        width={40}
        height={40}
        priority
        className={markClassName}
      />
    ) : (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <Image
          src="/brand/voxandra-mark.svg"
          alt=""
          width={42}
          height={42}
          priority
          className={markClassName}
        />
        <span className="leading-none">
          <span
            className={`block text-xl font-bold tracking-tight ${wordmarkColor}`}
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Voxandra
          </span>
          {showTagline && (
            <span className={`mt-1 block text-xs font-medium ${taglineColor}`}>
              {tagline}
            </span>
          )}
        </span>
      </span>
    );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="inline-flex items-center">
      {content}
    </Link>
  );
}
