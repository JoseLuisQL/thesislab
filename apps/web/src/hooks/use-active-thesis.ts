import { useEffect } from 'react';
import { useThesisStore } from '../stores/thesis';
import { useTheses, type ThesisSummary } from './use-api';

export function useActiveThesisSelection() {
  const selectedThesisId = useThesisStore((state) => state.selectedThesisId);
  const setSelectedThesisId = useThesisStore((state) => state.setSelectedThesisId);
  const thesesQuery = useTheses();
  const theses = thesesQuery.data?.theses ?? [];

  const selectedThesis =
    theses.find((thesis) => thesis.id === selectedThesisId)
    ?? theses[0]
    ?? null;

  useEffect(() => {
    if (selectedThesisId && theses.some((thesis) => thesis.id === selectedThesisId)) {
      return;
    }

    if (selectedThesis?.id) {
      setSelectedThesisId(selectedThesis.id);
    }
  }, [selectedThesis?.id, selectedThesisId, setSelectedThesisId, theses]);

  return {
    ...thesesQuery,
    theses,
    selectedThesisId: selectedThesis?.id ?? null,
    selectedThesis: selectedThesis as ThesisSummary | null,
    setSelectedThesisId,
  };
}
