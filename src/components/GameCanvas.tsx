import { Suspense, useRef, useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { IntroScene } from '@/components/3d/IntroScene';
import { ExplorationRoom, Player } from '@/components/3d/ExplorationScene';
import { FollowCamera } from '@/components/3d/FollowCamera';
import { useGameStore } from '@/store/gameStore';
import { bus } from '@/engine/events';
import { EXPLORATION_SCENE } from '@/data/exploration';
import './GameCanvas.css';

// ─── Loading Screen ───
function LoadingScreen({ onReady }: { onReady: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(onReady, 400);
          return 100;
        }
        return prev + Math.random() * 15 + 5;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [onReady]);

  return (
    <div className="loading-screen">
      <div className="loading-title">ВОЛОДКА</div>
      <div className="loading-subtitle">OLD BUT GOLD</div>
      <div className="loading-text">
        <span className="loading-bracket">{'>'}</span>
        <span className="loading-word">ИНИЦИАЛИЗАЦИЯ</span>
        <span className="loading-cursor">_</span>
      </div>
      <div className="loading-bar-track">
        <div className="loading-bar-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      <p className="loading-hint">Нажмите Enter или Пробел для пропуска</p>
    </div>
  );
}

// ─── Transition Overlay ───
function TransitionOverlay() {
  const transitioning = useGameStore(s => s.transitioning);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (transitioning) {
      setOpacity(1);
      const timer = setTimeout(() => {
        bus.emit('transition:complete', { to: 'exploration' });
        setTimeout(() => setOpacity(0), 100);
        useGameStore.getState().setTransitioning(false);
        useGameStore.getState().setPhase('exploration');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [transitioning]);

  return (
    <div
      className="transition-overlay"
      style={{ opacity }}
    />
  );
}

// ─── Intro HUD ───
function IntroHUD() {
  const phase = useGameStore(s => s.phase);
  const introPoemComplete = useGameStore(s => s.introPoemComplete);

  if (phase !== 'intro') return null;

  return (
    <div className="intro-hud">
      {!introPoemComplete && (
        <div className="intro-hint">
          <span className="intro-hint-bracket">[</span>
          ENTER / SPACE — пропустить
          <span className="intro-hint-bracket">]</span>
        </div>
      )}
    </div>
  );
}

// ─── Exploration HUD ───
function ExplorationHUD() {
  const phase = useGameStore(s => s.phase);
  const playerReady = useGameStore(s => s.playerReady);
  const hoveredObject = useGameStore(s => s.hoveredObject);

  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipData, setTooltipData] = useState<{ label: string; description: string } | null>(null);

  const handleInteraction = useCallback((target: string) => {
    const obj = EXPLORATION_SCENE.interactables.find(o => o.id === target);
    if (obj) {
      setTooltipData({ label: obj.label, description: obj.description });
      setShowTooltip(true);
      setTimeout(() => setShowTooltip(false), 5000);
    }
  }, []);

  useEffect(() => {
    const unsub = bus.on('interaction:select', ({ target }) => handleInteraction(target));
    return unsub;
  }, [handleInteraction]);

  if (phase !== 'exploration') return null;

  return (
    <div className="exploration-hud">
      {/* Scene title */}
      <div className="scene-title">
        <span className="scene-bracket">{'{'}</span>
        {EXPLORATION_SCENE.name}
        <span className="scene-bracket">{'}'}</span>
      </div>

      {/* Interaction hint */}
      {hoveredObject && (
        <div className="interact-hint">
          <span className="interact-key">E</span>
          <span className="interact-label">
            {EXPLORATION_SCENE.interactables.find(o => o.id === hoveredObject)?.label || 'Взаимодействовать'}
          </span>
        </div>
      )}

      {/* Tooltip */}
      {showTooltip && tooltipData && (
        <div className="tooltip-overlay" onClick={() => setShowTooltip(false)}>
          <div className="tooltip-box">
            <div className="tooltip-title">{tooltipData.label}</div>
            <div className="tooltip-desc">{tooltipData.description}</div>
            <div className="tooltip-close">[закрыть]</div>
          </div>
        </div>
      )}

      {/* Controls hint */}
      {!showTooltip && (
        <div className="controls-hint">
          WASD — движение &nbsp;|&nbsp; Мышь — камера &nbsp;|&nbsp; E — взаимодействие
        </div>
      )}
    </div>
  );
}

// ─── Main Game Canvas ───
export default function GameCanvas() {
  const phase = useGameStore(s => s.phase);
  const setPhase = useGameStore(s => s.setPhase);
  const setTransitioning = useGameStore(s => s.setTransitioning);
  const [ready, setReady] = useState(false);

  const handleReady = useCallback(() => {
    setReady(true);
    setPhase('intro');
  }, [setPhase]);

  // Listen for transitions
  useEffect(() => {
    const unsub = bus.on('transition:start', () => {
      setTransitioning(true);
    });
    return unsub;
  }, [setTransitioning]);

  if (!ready) {
    return <LoadingScreen onReady={handleReady} />;
  }

  return (
    <div className="game-container">
      <Canvas
        camera={{ fov: 60, near: 0.1, far: 100 }}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        style={{ background: '#000' }}
      >
        <Suspense fallback={null}>
          {/* Shared camera controller */}
          <FollowCamera />

          {/* Post-processing */}
          <EffectComposer>
            <Bloom
              luminanceThreshold={0.4}
              luminanceSmoothing={0.9}
              intensity={0.8}
              mipmapBlur
            />
            <Vignette eskil={false} offset={0.1} darkness={0.8} />
          </EffectComposer>

          {/* Intro Scene — Matrix Rain + Poem */}
          {phase === 'intro' && <IntroScene />}

          {/* Exploration Scene — Physics + Room + Player */}
          {(phase === 'exploration' || phase === 'intro-to-explore') && (
            <Physics gravity={[0, -9.81, 0]}>
              <ExplorationRoom />
              <Player />
            </Physics>
          )}
        </Suspense>
      </Canvas>

      {/* HTML Overlays */}
      <TransitionOverlay />
      <IntroHUD />
      <ExplorationHUD />
    </div>
  );
}
