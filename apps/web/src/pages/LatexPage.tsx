import { useEffect, useState } from 'react';
import { useActiveThesisSelection } from '../hooks/use-active-thesis';
import {
  useIntakeJob,
  useIntakeNodes,
  useIntakeReport,
  useLatexBuildMutation,
  useLatexBuilds,
  useLatexEditMutation,
  useLatexSectionPreview,
  useLatexStructure,
  useThesisDetail,
} from '../hooks/use-api';

export function LatexPage() {
  const { selectedThesis, selectedThesisId } = useActiveThesisSelection();
  const detailQuery = useThesisDetail(selectedThesisId);
  const activeWorkspace = detailQuery.data?.thesis.activeWorkspace;
  const intakeJobId = typeof activeWorkspace?.intakeJobId === 'string' ? activeWorkspace.intakeJobId : null;
  const intakeJobQuery = useIntakeJob(selectedThesisId, intakeJobId);
  const intakeReportQuery = useIntakeReport(selectedThesisId, intakeJobId);
  const intakeNodesQuery = useIntakeNodes(selectedThesisId, intakeJobId);
  const structureQuery = useLatexStructure(selectedThesisId);
  const buildsQuery = useLatexBuilds(selectedThesisId);
  const buildMutation = useLatexBuildMutation(selectedThesisId);
  const editMutation = useLatexEditMutation(selectedThesisId);

  const structure = structureQuery.data?.structure;
  const runs = buildsQuery.data?.runs ?? [];
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const sectionPreviewQuery = useLatexSectionPreview(selectedThesisId, selectedNodeId);
  const section = sectionPreviewQuery.data?.section;
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!structure?.outline.length) {
      return;
    }

    if (!selectedNodeId) {
      setSelectedNodeId(structure.outline[0].normalizedNodeId);
    }
  }, [selectedNodeId, structure?.outline]);

  useEffect(() => {
    if (section?.content !== undefined) {
      setDraft(section.content);
    }
  }, [section?.content]);

  const handleSave = async () => {
    if (!selectedThesisId || !section?.node.sourcePath || !section.node.anchor.start) {
      return;
    }

    await editMutation.mutateAsync({
      target: {
        normalizedNodeId: section.node.normalizedNodeId,
        sourcePath: section.node.sourcePath,
        title: section.node.title ?? 'Untitled node',
        nodeType: section.node.nodeType as 'chapter' | 'section' | 'subsection',
        anchorStart: section.node.anchor.start,
        anchorEnd: section.node.anchor.end,
      },
      replacement: draft,
      note: 'Web workbench edit',
      createdBy: 'web:latex-workbench',
    });
    await Promise.all([structureQuery.refetch(), sectionPreviewQuery.refetch(), buildsQuery.refetch()]);
  };

  return (
    <div className="space-y-8">
      <section className="glass-card p-6 md:p-8">
        <p className="editorial-kicker">Official Document</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">LaTeX workbench</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/55">
              Operate the official thesis document: inspect structure, edit sections safely, checkpoint changes and run builds with diagnostics.
            </p>
          </div>
          <button className="btn-primary" disabled={!selectedThesisId || buildMutation.isPending} onClick={() => selectedThesisId && buildMutation.mutate('web:latex-workbench')}>
            {buildMutation.isPending ? 'Building...' : 'Run build'}
          </button>
        </div>
      </section>

      {!selectedThesisId ? (
        <div className="glass-card p-10 text-center text-white/45">Create or select a thesis first.</div>
      ) : !structure ? (
        <div className="glass-card p-10 text-center text-white/45">
          No official LaTeX workspace is active yet. Import a LaTeX, DOCX or PDF project from the dashboard first.
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <section className="glass-card p-6">
              <p className="editorial-kicker">Structure</p>
              <div className="mt-4 space-y-3">
                {structure.outline.map((node) => (
                  <button
                    key={node.normalizedNodeId}
                    onClick={() => setSelectedNodeId(node.normalizedNodeId)}
                    className={`w-full rounded-[22px] border p-4 text-left transition ${
                      node.normalizedNodeId === selectedNodeId
                        ? 'border-[rgba(153,111,44,0.36)] bg-[rgba(153,111,44,0.12)]'
                        : 'border-white/8 bg-white/4 hover:border-white/16'
                    }`}
                    style={{ marginLeft: `${Math.max(0, node.level - 1) * 10}px` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">{node.title ?? 'Untitled node'}</p>
                        <p className="mt-1 text-xs text-white/35">{node.nodeType} · {node.sourcePath ?? 'n/a'}:{node.anchor.start ?? '?'}</p>
                      </div>
                      <span className="badge badge-info">L{node.level}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="glass-card p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="editorial-kicker">Editor</p>
                  <p className="mt-2 text-lg font-semibold text-white">{section?.node.title ?? 'Select a section'}</p>
                </div>
                {section?.node.nodeType && <span className="badge badge-degraded">{section.node.nodeType}</span>}
              </div>

              {section ? (
                <div className="mt-5 space-y-4">
                  <textarea
                    className="input-shell min-h-[380px] resize-y font-mono text-sm"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-3">
                    <button className="btn-primary" disabled={editMutation.isPending} onClick={() => void handleSave()}>
                      {editMutation.isPending ? 'Saving...' : 'Save section'}
                    </button>
                    <span className="text-sm text-white/40">{section.node.sourcePath}:{section.node.anchor.start}</span>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-white/40">Select a node from the structure to preview and edit it.</p>
              )}
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
            <section className="glass-card p-6">
              <p className="editorial-kicker">Intake Context</p>
              <div className="mt-4 space-y-4">
                <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Thesis</p>
                  <p className="mt-2 text-sm font-semibold text-white">{selectedThesis?.title}</p>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Entrypoint</p>
                  <p className="mt-2 text-sm font-semibold text-white">{structure.entrypoint ?? 'n/a'}</p>
                </div>
                {intakeJobQuery.data?.intakeJob && (
                  <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                    <p className="text-xs text-white/35">Imported format</p>
                    <p className="mt-2 text-sm font-semibold text-white">{intakeJobQuery.data.intakeJob.sourceFormat.toUpperCase()}</p>
                  </div>
                )}
                {(intakeReportQuery.data?.report.warnings as string[] | undefined)?.length ? (
                  <div className="rounded-[20px] border border-[rgba(251,191,36,0.18)] bg-[rgba(70,48,10,0.18)] p-4">
                    <p className="text-sm font-semibold text-[var(--color-accent-amber)]">Intake warnings</p>
                    <ul className="mt-3 space-y-2 text-sm text-white/58">
                      {(intakeReportQuery.data?.report.warnings as string[]).slice(0, 4).map((warning) => (
                        <li key={warning}>• {warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {intakeNodesQuery.data?.nodes.length ? (
                  <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                    <p className="text-xs text-white/35">Normalized nodes</p>
                    <p className="mt-2 text-sm font-semibold text-white">{intakeNodesQuery.data.nodes.length}</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="glass-card p-6">
              <p className="editorial-kicker">Build Diagnostics</p>
              <div className="mt-4 space-y-4">
                {runs.length === 0 ? (
                  <p className="text-sm text-white/38">No build runs yet.</p>
                ) : runs.map((run) => (
                  <div key={run.id} className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">{new Date(run.startedAt).toLocaleString()}</p>
                        <p className="mt-1 text-xs text-white/35">{run.bibliographyStatus || 'bibliography unknown'}</p>
                      </div>
                      <span className={`badge ${run.status === 'completed' ? 'badge-available' : run.status.includes('warning') ? 'badge-degraded' : 'badge-error'}`}>
                        {run.status}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-[16px] bg-white/4 p-3 text-center">
                        <p className="text-lg font-semibold text-[var(--color-accent-red)]">{run.diagnosticsSummary.errorCount}</p>
                        <p className="text-[10px] text-white/30">errors</p>
                      </div>
                      <div className="rounded-[16px] bg-white/4 p-3 text-center">
                        <p className="text-lg font-semibold text-[var(--color-accent-amber)]">{run.diagnosticsSummary.warningCount}</p>
                        <p className="text-[10px] text-white/30">warnings</p>
                      </div>
                      <div className="rounded-[16px] bg-white/4 p-3 text-center">
                        <p className="text-lg font-semibold text-white">{run.diagnosticsSummary.infoCount}</p>
                        <p className="text-[10px] text-white/30">info</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {run.diagnostics.slice(0, 6).map((diagnostic, index) => (
                        <div key={`${run.id}-${index}`} className="rounded-[16px] border border-white/8 bg-white/4 p-3">
                          <p className="text-sm text-white/72">{diagnostic.message}</p>
                          <p className="mt-1 text-xs text-white/35">{diagnostic.filePath ?? 'workspace'}{diagnostic.line ? `:${diagnostic.line}` : ''}</p>
                        </div>
                      ))}
                    </div>
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
