import React, { useRef, useMemo, useEffect, useState, forwardRef, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OPENING_POEM, MATRIX_DURATION, POEM_REVEAL_DELAY } from '@/data/poem';
import { useGameStore } from '@/store/gameStore';
import { bus } from '@/engine/events';

// ─── Poem Line ───
// Rendered as a plane with canvas texture for crisp text

const PoemLine = forwardRef<THREE.Mesh, {
  text: string;
  position: [number, number, number];
  opacity: number;
  active: boolean;
  completed: boolean;
}>(({ text, position, opacity, active, completed }, ref) => {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (text.trim() === '') return;

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 64;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 64);

    // Font: slightly different weight when completed vs active
    const fontWeight = completed ? '700' : '600';
    const fontSize = completed ? '28px' : '30px';
    ctx.font = `${fontWeight} ${fontSize} "Courier New", monospace`;
    ctx.fillStyle = completed ? '#00cc33' : '#00ff41';
    ctx.shadowColor = '#00ff41';
    ctx.shadowBlur = active ? 20 : 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 32);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    setTexture(tex);

    return () => { tex.dispose(); };
  }, [text, active, completed]);

  if (!texture || text.trim() === '') return null;

  return (
    <mesh ref={ref} position={position}>
      <planeGeometry args={[text.length * 0.28 + 0.6, 0.32]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
});
PoemLine.displayName = 'PoemLine';

// ─── Poem Reveal Controller ───
// Reveals poem lines one by one after Matrix Rain finishes

function PoemReveal() {
  const introStep = useGameStore(s => s.introStep);
  const setIntroStep = useGameStore(s => s.setIntroStep);
  const introMatrixDone = useGameStore(s => s.introMatrixDone);
  const setIntroPoemComplete = useGameStore(s => s.setIntroPoemComplete);
  const totalLines = OPENING_POEM.length;
  const startTimeRef = useRef<number>(0);
  const revealedRef = useRef(0);

  useEffect(() => {
    if (!introMatrixDone) return;
    startTimeRef.current = Date.now();
    revealedRef.current = Math.min(introStep, totalLines);

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const newLines = Math.min(Math.floor(elapsed / POEM_REVEAL_DELAY), totalLines);

      if (newLines > revealedRef.current) {
        for (let i = revealedRef.current; i < newLines; i++) {
          bus.emit('intro:poem-line', { index: i, text: OPENING_POEM[i] });
        }
        revealedRef.current = newLines;
        setIntroStep(newLines);

        if (newLines >= totalLines) {
          setIntroPoemComplete(true);
          bus.emit('intro:poem-complete', {});
          clearInterval(interval);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [introMatrixDone, totalLines, setIntroStep, setIntroPoemComplete]);

  const linePositions = useMemo(() => {
    const positions: [number, number, number][] = [];
    const nonEmptyCount = OPENING_POEM.filter(l => l.trim() !== '').length;
    const startY = (nonEmptyCount * 0.4) / 2;
    let y = startY;
    for (let i = 0; i < totalLines; i++) {
      if (OPENING_POEM[i].trim() === '') {
        y -= 0.15;
        positions.push([0, y, 0]);
      } else {
        positions.push([0, y, 0]);
        y -= 0.4;
      }
    }
    return positions;
  }, []);

  const [glowPulse, setGlowPulse] = useState(1);

  useFrame(({ clock }) => {
    if (introStep < totalLines && introMatrixDone) {
      setGlowPulse(Math.sin(clock.getElapsedTime() * 3) * 0.15 + 0.85);
    }
  });

  return (
    <group position={[0, 0, -3]}>
      {OPENING_POEM.map((line, i) => {
        const isRevealed = i <= introStep;
        const isActive = i === introStep && introMatrixDone;
        const isCompleted = isRevealed && !isActive;
        const op = isRevealed
          ? (isActive ? glowPulse : 1.0)
          : 0.0;

        return (
          <PoemLine
            key={i}
            text={line}
            position={linePositions[i]}
            opacity={op}
            active={isActive}
            completed={isCompleted}
          />
        );
      })}
    </group>
  );
}

// ─── Matrix Rain Background ───
// GLSL shader-based Matrix Rain with fade-out capability

function MatrixRain({ fadeOut }: { fadeOut: number }) {
  const uniforms = useRef({
    uTime: { value: 0 },
    uFade: { value: 1.0 },
  });

  useFrame(({ clock }) => {
    uniforms.current.uTime.value = clock.getElapsedTime();
    uniforms.current.uFade.value = fadeOut;
  });

  return (
    <mesh position={[0, 0, -5]}>
      <planeGeometry args={[20, 14]} />
      <shaderMaterial
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          precision mediump float;
          uniform float uTime;
          uniform float uFade;
          varying vec2 vUv;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          void main() {
            float col = floor(vUv.x * 60.0);
            float rowOffset = hash(vec2(col, 0.0));
            float speed = 0.4 + rowOffset * 0.8;
            float t = fract(vUv.y * 35.0 + uTime * speed);

            float head = smoothstep(0.93, 1.0, t);
            float trail = smoothstep(0.0, 0.5, t) * (1.0 - smoothstep(0.5, 1.0, t));

            float gv = 0.65 + rowOffset * 0.35;
            vec3 headCol = vec3(0.5 * gv, 1.0 * gv, 0.35 * gv);
            vec3 trailCol = vec3(0.0, 0.12 * gv, 0.0);

            vec3 color = mix(trailCol, headCol, head * trail);
            float edgeFade = smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);

            // Vignette
            vec2 center = vUv - 0.5;
            float vignette = 1.0 - dot(center, center) * 0.8;

            gl_FragColor = vec4(color, edgeFade * vignette * 0.28 * uFade);
          }
        `}
        uniforms={uniforms.current}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

// ─── Full Intro Scene ───
// Matrix Rain → Poem Lines → Fade → Transition

export function IntroScene() {
  const setPhase = useGameStore(s => s.setPhase);
  const introMatrixDone = useGameStore(s => s.introMatrixDone);
  const setIntroMatrixDone = useGameStore(s => s.setIntroMatrixDone);
  const introPoemComplete = useGameStore(s => s.introPoemComplete);
  const setIntroStep = useGameStore(s => s.setIntroStep);
  const setIntroPoemComplete = useGameStore(s => s.setIntroPoemComplete);
  const [matrixFade, setMatrixFade] = useState(1.0);
  const [poemFade, setPoemFade] = useState(1.0);
  const skipRef = useRef(false);

  // Matrix Rain → fade out → start poem
  useEffect(() => {
    const timer = setTimeout(() => {
      setIntroMatrixDone(true);
      bus.emit('intro:matrix-done', {});

      // Fade matrix rain out over 1.5s
      const fadeStart = Date.now();
      const fadeInterval = setInterval(() => {
        const elapsed = Date.now() - fadeStart;
        const t = Math.min(elapsed / 1500, 1);
        setMatrixFade(1 - t);
        if (t >= 1) clearInterval(fadeInterval);
      }, 16);
    }, MATRIX_DURATION);
    return () => clearTimeout(timer);
  }, [setIntroMatrixDone]);

  // Poem complete → fade poem out → transition
  useEffect(() => {
    if (!introPoemComplete) return;
    const fadeStart = Date.now();
    const fadeInterval = setInterval(() => {
      const elapsed = Date.now() - fadeStart;
      const t = Math.min(elapsed / 2000, 1);
      setPoemFade(1 - t);
      if (t >= 1) {
        clearInterval(fadeInterval);
      }
    }, 16);

    const transitionTimer = setTimeout(() => {
      bus.emit('transition:start', { from: 'intro', to: 'exploration' });
      setPhase('intro-to-explore');
    }, 2500);
    return () => {
      clearTimeout(transitionTimer);
      clearInterval(fadeInterval);
    };
  }, [introPoemComplete, setPhase]);

  // Skip handler
  useEffect(() => {
    const handleSkip = useCallback(() => {
      if (introPoemComplete || skipRef.current) return;
      skipRef.current = true;
      bus.emit('intro:skip', {});
      setIntroMatrixDone(true);
      setIntroStep(OPENING_POEM.length);
      setMatrixFade(0);
      // Small delay then complete poem
      setTimeout(() => {
        setIntroPoemComplete(true);
      }, 300);
    }, [introPoemComplete, setIntroMatrixDone, setIntroStep, setIntroPoemComplete]);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [introPoemComplete, setIntroMatrixDone, setIntroStep, setIntroPoemComplete]);

  return (
    <group>
      {/* Background plane */}
      <mesh position={[0, 0, -8]}>
        <planeGeometry args={[30, 20]} />
        <meshBasicMaterial color="#020208" />
      </mesh>

      {/* Matrix Rain (fades out) */}
      <MatrixRain fadeOut={matrixFade} />

      {/* Poem Lines (fades out after complete) */}
      <group>
        <PoemReveal />
      </group>

      {/* Subtle bottom glow */}
      <mesh position={[0, -4, -6]}>
        <planeGeometry args={[16, 2]} />
        <meshBasicMaterial color="#001a00" transparent opacity={0.4} />
      </mesh>

      <ambientLight intensity={0.06} />
    </group>
  );
}
