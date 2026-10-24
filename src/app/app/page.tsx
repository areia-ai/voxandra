import { Suspense } from "react";
import { DashboardContent } from "./dashboard-content";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-sm text-stone-500">
          Loading dashboard...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}