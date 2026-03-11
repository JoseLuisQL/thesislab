import { create } from 'zustand';

type ThesisState = {
  selectedThesisId: string | null;
  sidebarCollapsed: boolean;
  setSelectedThesisId: (id: string | null) => void;
  toggleSidebar: () => void;
};

export const useThesisStore = create<ThesisState>((set) => ({
  selectedThesisId: null,
  sidebarCollapsed: false,
  setSelectedThesisId: (id) => set({ selectedThesisId: id }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
