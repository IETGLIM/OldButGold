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
    <div className="transition-overlay" style={{ opacity }} />
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

// ─── Terminal Overlay (typewriter effect) ───
function TerminalOverlay({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  const [displayedLines, setDisplayedLines] = useState<number>(0);
  const [displayedChars, setDisplayedChars] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (displayedLines >= lines.length) return;

    const currentLine = lines[displayedLines];
    if (!currentLine && currentLine !== '') {
      setDisplayedLines(prev => prev + 1);
      setDisplayedChars(0);
      return;
    }

    if (displayedChars < currentLine.length) {
      const delay = currentLine[displayedChars] === ' ' ? 20 : 30 + Math.random() * 25;
      const timer = setTimeout(() => {
        setDisplayedChars(prev => prev + 1);
      }, delay);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setDisplayedLines(prev => prev + 1);
        setDisplayedChars(0);
      }, currentLine === '' ? 100 : 200);
      return () => clearTimeout(timer);
    }
  }, [displayedLines, displayedChars, lines]);

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [displayedLines, displayedChars]);

  // Close on ESC or click backdrop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="terminal-overlay" onClick={onClose}>
      <div className="terminal-box" onClick={e => e.stopPropagation()}>
        <div className="terminal-header">
          <span className="terminal-dots">
            <span className="terminal-dot terminal-dot-red" />
            <span className="terminal-dot terminal-dot-yellow" />
            <span className="terminal-dot terminal-dot-green" />
          </span>
          <span className="terminal-title">TERMINAL — volodka@memory:~</span>
        </div>
        <div className="terminal-body" ref={containerRef}>
          {lines.slice(0, displayedLines).map((line, i) => (
            <div key={i} className="terminal-line">{line}</div>
          ))}
          {displayedLines < lines.length && lines[displayedLines] && (
            <div className="terminal-line">
              {lines[displayedLines].slice(0, displayedChars)}
              <span className="terminal-cursor">█</span>
            </div>
          )}
        </div>
        <div className="terminal-footer">
          [ESC / Enter — закрыть]
        </div>
      </div>
    </div>
  );
}

// ─── Tooltip Overlay ───
function TooltipOverlay({ label, description, onClose }: {
  label: string; description: string; onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'e') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tooltip-overlay" onClick={onClose}>
      <div className="tooltip-box" onClick={e => e.stopPropagation()}>
        <div className="tooltip-title">{label}</div>
        <div className="tooltip-desc">{description}</div>
        <div className="tooltip-close">[закрыть]</div>
      </div>
    </div>
  );
}

// ─── Exploration HUD ───
function ExplorationHUD() {
  const phase = useGameStore(s => s.phase);
  const hoveredObject = useGameStore(s => s.hoveredObject);

  const [overlay, setOverlay] = useState<{
    type: 'tooltip' | 'terminal';
    label: string;
    description?: string;
    terminalText?: string[];
  } | null>(null);

  const closeOverlay = useCallback(() => setOverlay(null), []);

  const handleInteraction = useCallback((target: string) => {
    const obj = EXPLORATION_SCENE.interactables.find(o => o.id === target);
    if (!obj) return;

    if (obj.terminalText) {
      setOverlay({
        type: 'terminal',
        label: obj.label,
        terminalText: obj.terminalText,
      });
    } else {
      setOverlay({
        type: 'tooltip',
        label: obj.label,
        description: obj.description,
      });
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
      {hoveredObject && !overlay && (
        <div className="interact-hint">
          <span className="interact-key">E</span>
          <span className="interact-label">
            {EXPLORATION_SCENE.interactables.find(o => o.id === hoveredObject)?.label || 'Взаимодействовать'}
          </span>
        </div>
      )}

      {/* Terminal overlay */}
      {overlay?.type === 'terminal' && overlay.terminalText && (
        <TerminalOverlay lines={overlay.terminalText} onClose={closeOverlay} />
      )}

      {/* Tooltip overlay */}
      {overlay?.type === 'tooltip' && overlay.description && (
        <TooltipOverlay label={overlay.label} description={overlay.description} onClose={closeOverlay} />
      )}

      {/* Controls hint */}
      {!overlay && (
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
          <FollowCamera />

          <EffectComposer>
            <Bloom
              luminanceThreshold={0.4}
              luminanceSmoothing={0.9}
              intensity={0.8}
              mipmapBlur
            />
            <Vignette eskil={false} offset={0.1} darkness={0.8} />
          </EffectComposer>

          {phase === 'intro' && <IntroScene />}

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
