import { MessageCircle } from "lucide-react";
import { Shell } from "@/components/Shell";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";

// Feature disabled pending a real messaging backend — see nav.chat in Shell.tsx
// for the matching disabled sidebar entry.
export function Chat() {
  return (
    <Shell>
      <div className="fade-in max-w-4xl">
        <PageHeader title="Chat" subtitle="Message student support." />
        <EmptyState className="mt-6" icon={MessageCircle} title="Coming Soon"
          hint="JevisLab is working on this feature." />
      </div>
    </Shell>
  );
}
