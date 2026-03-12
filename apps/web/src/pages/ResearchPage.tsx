import { useState } from 'react';
import { useActiveThesisSelection } from '../hooks/use-active-thesis';
import {
  useCitations,
  useClaims,
  useEvidence,
  useResearchCaptureMutation,
  useResearchFetchMutation,
  useResearchSearchMutation,
  useSources,
  useSyncZoteroBibliographyMutation,
} from '../hooks/use-api';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

export function ResearchPage() {
  const { selectedThesis, selectedThesisId } = useActiveThesisSelection();
  const sourcesQuery = useSources(selectedThesisId);
  const evidenceQuery = useEvidence(selectedThesisId);
  const claimsQuery = useClaims(selectedThesisId);
  const citationsQuery = useCitations(selectedThesisId);
  const searchMutation = useResearchSearchMutation(selectedThesisId);
  const fetchMutation = useResearchFetchMutation(selectedThesisId);
  const captureMutation = useResearchCaptureMutation(selectedThesisId);
  const syncMutation = useSyncZoteroBibliographyMutation(selectedThesisId);

  const [query, setQuery] = useState('evidence-first thesis methodology');
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [authors, setAuthors] = useState('Ada Lovelace, Grace Hopper');
  const [evidenceSnippet, setEvidenceSnippet] = useState('');
  const [claimText, setClaimText] = useState('');
  const [citationKey, setCitationKey] = useState('lovelace2026');

  const searchResults = searchMutation.data?.results ?? [];
  const fetchedPage = fetchMutation.data?.page;
  const sources = sourcesQuery.data?.sources ?? [];
  const evidence = evidenceQuery.data?.evidenceFragments ?? [];
  const claims = claimsQuery.data?.claims ?? [];
  const citations = citationsQuery.data?.citations ?? [];

  const handleSearch = async () => {
    if (!selectedThesisId || !query.trim()) {
      return;
    }

    const result = await searchMutation.mutateAsync(query.trim());
    const first = result.results[0] ?? null;
    setSelectedResult(first);
    if (first) {
      setClaimText(first.title);
      setEvidenceSnippet(first.snippet);
    }
  };

  const handleFetch = async (result: SearchResult) => {
    if (!selectedThesisId) {
      return;
    }

    setSelectedResult(result);
    const payload = await fetchMutation.mutateAsync(result.url);
    setEvidenceSnippet(payload.page.text.slice(0, 420));
    setClaimText(result.title);
  };

  const handleCapture = async () => {
    if (!selectedThesisId || !selectedResult) {
      return;
    }

    await captureMutation.mutateAsync({
      source: {
        sourceType: 'web',
        title: selectedResult.title,
        authors: authors.split(',').map((item) => item.trim()).filter(Boolean),
        locator: selectedResult.url,
      },
      evidence: evidenceSnippet.trim()
        ? {
            snippet: evidenceSnippet.trim(),
            extractionMethod: fetchedPage ? 'openclaw-fetch' : 'academic-search',
            confidence: fetchedPage ? 0.84 : 0.61,
            status: 'captured',
          }
        : undefined,
      claim: claimText.trim() ? { text: claimText.trim(), status: 'draft' } : undefined,
      citation: citationKey.trim()
        ? { citationKey: citationKey.trim(), locator: selectedResult.url, style: 'bibtex', status: 'linked' }
        : undefined,
    });
  };

  return (
    <div className="space-y-8">
      <section className="glass-card p-6 md:p-8">
        <p className="editorial-kicker">Research</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Evidence capture desk</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/55">
              Search, fetch and persist evidence directly into the thesis graph. Zotero bibliography sync writes to the official
              LaTeX workspace.
            </p>
          </div>
          <button
            className="btn-primary"
            disabled={!selectedThesisId || syncMutation.isPending}
            onClick={() => selectedThesisId && syncMutation.mutate()}
          >
            {syncMutation.isPending ? 'Syncing...' : 'Sync Zotero .bib'}
          </button>
        </div>
        {selectedThesis && (
          <div className="mt-5 rounded-[22px] border border-white/8 bg-black/20 p-4">
            <p className="text-sm font-semibold text-white">{selectedThesis.title}</p>
            <p className="mt-1 text-xs text-white/40">{selectedThesis.degreeProgram}</p>
          </div>
        )}
      </section>

      {!selectedThesisId ? (
        <div className="glass-card p-10 text-center text-white/45">Create or select a thesis first.</div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <section className="glass-card p-6">
              <p className="editorial-kicker">Search Sources</p>
              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <input
                  className="input-shell flex-1"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search academic literature"
                />
                <button className="btn-primary" disabled={searchMutation.isPending} onClick={() => void handleSearch()}>
                  {searchMutation.isPending ? 'Searching...' : 'Run search'}
                </button>
              </div>
              {searchMutation.error && <p className="mt-4 text-sm text-[var(--color-accent-red)]">{searchMutation.error.message}</p>}
              <div className="mt-5 space-y-3">
                {searchResults.length === 0 ? (
                  <p className="text-sm text-white/38">Run a search to load candidate sources.</p>
                ) : searchResults.map((result) => (
                  <button
                    key={result.url}
                    onClick={() => void handleFetch(result)}
                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                      selectedResult?.url === result.url
                        ? 'border-[rgba(153,111,44,0.36)] bg-[rgba(153,111,44,0.12)]'
                        : 'border-white/8 bg-white/4 hover:border-white/16'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">{result.title}</p>
                        <p className="mt-1 text-xs text-white/35">{result.source}</p>
                      </div>
                      <span className="badge badge-info">Fetch</span>
                    </div>
                    <p className="mt-3 text-xs leading-6 text-white/48">{result.snippet}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="glass-card p-6">
              <p className="editorial-kicker">Capture Artifact</p>
              {selectedResult ? (
                <div className="space-y-4">
                  <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                    <p className="text-sm font-semibold text-white">{selectedResult.title}</p>
                    <p className="mt-2 text-xs text-white/35">{selectedResult.url}</p>
                  </div>
                  <input
                    className="input-shell"
                    value={authors}
                    onChange={(event) => setAuthors(event.target.value)}
                    placeholder="Authors"
                  />
                  <textarea
                    className="input-shell min-h-[160px] resize-y"
                    value={evidenceSnippet}
                    onChange={(event) => setEvidenceSnippet(event.target.value)}
                    placeholder="Evidence snippet"
                  />
                  <textarea
                    className="input-shell min-h-[120px] resize-y"
                    value={claimText}
                    onChange={(event) => setClaimText(event.target.value)}
                    placeholder="Claim text"
                  />
                  <input
                    className="input-shell"
                    value={citationKey}
                    onChange={(event) => setCitationKey(event.target.value)}
                    placeholder="Citation key"
                  />
                  <button className="btn-primary w-full justify-center" disabled={captureMutation.isPending} onClick={() => void handleCapture()}>
                    {captureMutation.isPending ? 'Capturing...' : 'Capture into thesis'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-white/38">Pick a result to fetch and persist it as source, evidence, claim and citation.</p>
              )}
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-4">
            <section className="glass-card p-5">
              <p className="editorial-kicker">Sources</p>
              <p className="mt-2 text-2xl font-semibold text-white">{sources.length}</p>
              <div className="mt-4 space-y-3">
                {sources.slice(0, 5).map((source) => (
                  <div key={source.id} className="rounded-[18px] border border-white/8 bg-black/20 p-3">
                    <p className="text-sm font-semibold text-white">{source.title}</p>
                    <p className="mt-1 text-xs text-white/35">{source.authors.join(', ') || 'Unknown author'}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="glass-card p-5">
              <p className="editorial-kicker">Evidence</p>
              <p className="mt-2 text-2xl font-semibold text-white">{evidence.length}</p>
              <div className="mt-4 space-y-3">
                {evidence.slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-[18px] border border-white/8 bg-black/20 p-3">
                    <p className="text-xs leading-6 text-white/55">{item.snippet}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="glass-card p-5">
              <p className="editorial-kicker">Claims</p>
              <p className="mt-2 text-2xl font-semibold text-white">{claims.length}</p>
              <div className="mt-4 space-y-3">
                {claims.slice(0, 5).map((claim) => (
                  <div key={claim.id} className="rounded-[18px] border border-white/8 bg-black/20 p-3">
                    <p className="text-sm text-white/70">{claim.text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="glass-card p-5">
              <p className="editorial-kicker">Citations</p>
              <p className="mt-2 text-2xl font-semibold text-white">{citations.length}</p>
              <div className="mt-4 space-y-3">
                {citations.slice(0, 5).map((citation) => (
                  <div key={citation.id} className="rounded-[18px] border border-white/8 bg-black/20 p-3">
                    <p className="text-sm font-semibold text-white">{citation.citationKey}</p>
                    <p className="mt-1 text-xs text-white/35">{citation.style}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
