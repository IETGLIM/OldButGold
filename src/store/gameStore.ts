// ─── Game Store ───
// Minimal but clean Zustand store for two scenes

import { create } from 'zustand';

export type GamePhase = 'loading' | 'intro' | 'intro-to-explore' | 'exploration';

interface GameState {
  // Phase
  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  // Intro state
  introStep: number;          // 0-6: lines revealed, 7: complete
  setIntroStep: (step: number) => void;
  introMatrixDone: boolean;
  setIntroMatrixDone: (done: boolean) => void;
  introPoemComplete: boolean;
  setIntroPoemComplete: (done: boolean) => void;

  // Transition
  transitioning: boolean;
  setTransitioning: (v: boolean) => void;

  // Exploration
  playerReady: boolean;
  setPlayerReady: (v: boolean) => void;

  // Interaction
  hoveredObject: string | null;
  setHoveredObject: (id: string | null) => void;
}

export const useGameStore = create<GameState>((set) => ({
  phase: 'loading',
  setPhase: (phase) => set({ phase }),

  introStep: 0,
  setIntroStep: (step) => set({ introStep: step }),
  introMatrixDone: false,
  setIntroMatrixDone: (done) => set({ introMatrixDone: done }),
  introPoemComplete: false,
  setIntroPoemComplete: (done) => set({ introPoemComplete: done }),

  transitioning: false,
  setTransitioning: (v) => set({ transitioning: v }),

  playerReady: false,
  setPlayerReady: (v) => set({ playerReady: v }),

  hoveredObject: null,
  setHoveredObject: (id) => set({ hoveredObject: id }),
}));
