import { useSources, useEvidence, useClaims, useTheses } from '../hooks/use-api';
import { useThesisStore } from '../stores/thesis';

export function ResearchPage() {
  const selectedThesisId = useThesisStore((s) => s.selectedThesisId);
  const { data: thesesData } = useTheses();
  const { data: sourcesData, isLoading: loadingSources } = useSources(selectedThesisId);
  const { data: evidenceData } = useEvidence(selectedThesisId);
  const { data: claimsData } = useClaims(selectedThesisId);

  const theses = (thesesData as Record<string, unknown>)?.theses as Array<{ id: string; title: string }> | undefined;
  const sources = (sourcesData as Record<string, unknown>)?.sources as Array<{
    id: string; title: string; sourceType: string; status: string; authors: string[]; publicationYear: number | null;
  }> | undefined;
  const evidence = (evidenceData as Record<string, unknown>)?.fragments as Array<{
    id: string; snippet: string; extractionMethod: string; confidence: number | null; status: string;
  }> | undefined;
  const claims = (claimsData as Record<string, unknown>)?.claims as Array<{
    id: string; text: string; status: string; supportSummary: string; evidenceLinks: unknown[];
  }> | undefined;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Research & Evidence</h1>
        <p className="text-sm text-white/40">Sources, evidence fragments, and claims</p>
      </div>

      {/* Thesis selector */}
      {!selectedThesisId && theses && theses.length > 0 && (
        <div className="glass-card p-5">
          <p className="text-sm text-white/50 mb-3">Select a thesis to view research data:</p>
          <div className="flex flex-wrap gap-2">
            {theses.map((t) => (
              <button
                key={t.id}
                onClick={() => useThesisStore.getState().setSelectedThesisId(t.id)}
                className="btn-primary text-xs"
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedThesisId && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sources */}
          <div className="glass-card p-5">
            <h2 className="section-title mb-4">Sources ({sources?.length ?? 0})</h2>
            {loadingSources ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="shimmer h-12" />)}</div>
            ) : sources && sources.length > 0 ? (
              <div className="space-y-3">
                {sources.map((s) => (
                  <div key={s.id} className="border border-white/5 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="text-sm font-medium text-white/80 leading-tight">{s.title}</h3>
                      <span className={`badge ${s.status === 'ready' ? 'badge-available' : s.status === 'failed' ? 'badge-error' : 'badge-info'}`}>
                        {s.sourceType}
                      </span>
                    </div>
                    <p className="text-xs text-white/30">
                      {s.authors.join(', ')}{s.publicationYear ? ` (${s.publicationYear})` : ''}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/30">No sources registered.</p>
            )}
          </div>

          {/* Evidence */}
          <div className="glass-card p-5">
            <h2 className="section-title mb-4">Evidence ({evidence?.length ?? 0})</h2>
            {evidence && evidence.length > 0 ? (
              <div className="space-y-3">
                {evidence.slice(0, 10).map((e) => (
                  <div key={e.id} className="border border-white/5 rounded-lg p-3">
                    <p className="text-xs text-white/60 line-clamp-3">{e.snippet}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`badge ${e.status === 'captured' ? 'badge-available' : e.status === 'needs_review' ? 'badge-degraded' : 'badge-error'}`}>
                        {e.status}
                      </span>
                      {e.confidence !== null && (
                        <span className="text-[10px] text-white/20">{Math.round(e.confidence * 100)}% conf.</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/30">No evidence fragments.</p>
            )}
          </div>

          {/* Claims */}
          <div className="glass-card p-5">
            <h2 className="section-title mb-4">Claims ({claims?.length ?? 0})</h2>
            {claims && claims.length > 0 ? (
              <div className="space-y-3">
                {claims.map((c) => (
                  <div key={c.id} className="border border-white/5 rounded-lg p-3">
                    <p className="text-sm text-white/70 mb-2">{c.text}</p>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${c.status === 'supported' ? 'badge-available' : c.status === 'contested' ? 'badge-error' : 'badge-info'}`}>
                        {c.status}
                      </span>
                      <span className="text-[10px] text-white/20">{c.evidenceLinks.length} link(s)</span>
                    </div>
                    {c.supportSummary && (
                      <p className="text-xs text-white/30 mt-1">{c.supportSummary}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/30">No claims defined.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
