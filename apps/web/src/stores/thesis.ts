import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThesisState = {
  selectedThesisId: string | null;
  sidebarCollapsed: boolean;
  setSelectedThesisId: (id: string | null) => void;
  toggleSidebar: () => void;
};

export const useThesisStore = create<ThesisState>()(
  persist(
    (set) => ({
      selectedThesisId: null,
      sidebarCollapsed: false,
      setSelectedThesisId: (id) => set({ selectedThesisId: id }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'thesis-web-store',
      partialize: (state) => ({
        selectedThesisId: state.selectedThesisId,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
