// ─── Exploration Scene Data ───
// Minimal scene definition for the first exploration area

export interface SceneExit {
  id: string;
  label: string;
  position: [number, number, number];
}

export interface InteractiveObject {
  id: string;
  label: string;
  position: [number, number, number];
  color: string;
  description: string;
}

export const EXPLORATION_SCENE = {
  name: 'Комната Володки',
  description: 'Маленькая комната с мерцающим экраном. Тишина, нарушаемая лишь гулом сервера.',
  ambientLight: 0.15,
  fogColor: '#0a0a12',
  fogNear: 8,
  fogFar: 25,
  exits: [
    { id: 'exit_door', label: 'Дверь (наружу)', position: [0, 0.5, -4.5] } as SceneExit,
  ],
  interactables: [
    {
      id: 'terminal',
      label: 'Терминал',
      position: [1.5, 0.8, -2],
      color: '#00ff41',
      description: 'Старый CRT-монитор с зелёным текстом. На экране — строки, похожие на стихи.',
    } as InteractiveObject,
    {
      id: 'photo',
      label: 'Фотография',
      position: [-1.8, 1.1, -1],
      color: '#ffd700',
      description: 'Пожелтевшая фотография. Люди на ней улыбаются — давно, в другом мире.',
    } as InteractiveObject,
    {
      id: 'window',
      label: 'Окно',
      position: [-0.5, 1.3, -4.2],
      color: '#00e5ff',
      description: 'За окном — неоновые огни. Город не спит. Он никогда не спит.',
    } as InteractiveObject,
  ],
};
