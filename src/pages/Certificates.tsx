import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Award, ExternalLink, Printer } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import type { Certificate, Exam } from "@shared/types";

type CertWithExam = Certificate & { exam?: Exam };

export function Certificates() {
  const navigate = useNavigate();
  const [certs, setCerts] = useState<CertWithExam[] | null>(null);

  useEffect(() => {
    api.get<{ certificates: CertWithExam[] }>("/certificates").then((d) => setCerts(d.certificates)).catch(() => setCerts([]));
  }, []);

  return (
    <Shell>
      <div className="fade-in">
        <PageHeader title="Certificates" subtitle="Credentials you've earned. Each has a verifiable public link." />

        {!certs && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
        )}

        {certs && certs.length === 0 && (
          <EmptyState
            className="mt-6"
            icon={Award}
            title="No certificates yet"
            hint="Pass a proctored exam to earn your first credential."
            action={<button onClick={() => navigate("/exams")} className="btn btn-primary h-9">Browse exams</button>}
          />
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {certs?.map((c) => (
            <div key={c.id} className="card overflow-hidden">
              <div className="flex items-center gap-3 bg-[#111110] p-5 text-white">
                <Award className="h-8 w-8" />
                <div>
                  <p className="text-sm font-semibold leading-tight">{c.exam?.title ?? "Examination"}</p>
                  <p className="text-xs text-white/70">Score {c.score}%</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="font-mono text-xs text-[var(--muted)]">{c.certNumber}</p>
                  <p className="text-xs text-[var(--muted)]">Issued {new Date(c.issuedAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/certificate/${c.certNumber}`} className="btn btn-primary"><Printer className="h-4 w-4" /> View</Link>
                  <Link to={`/verify/${c.certNumber}`} className="btn btn-outline" title="Public verification page">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
