export function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-5">
      <p className="text-xs font-semibold uppercase text-stone-500">Coming soon</p>
      <h3 className="mt-2 text-base font-semibold text-stone-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
    </div>
  );
}
