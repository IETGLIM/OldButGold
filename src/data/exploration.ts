// ─── Exploration Scene Data ───
// Rich scene definition with narrative content

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
  terminalText?: string[];  // Lines typed out for terminal objects
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
      position: [1.5, 0.8, -3.5],
      color: '#00ff41',
      description: 'Старый CRT-монитор с зелёным текстом. На экране — строки, похожие на стихи.',
      terminalText: [
        '╔══════════════════════════════════╗',
        '║  СИСТЕМНЫЙ ЖУРНАЛ #47           ║',
        '║  Дата: 2089-03-15 03:42:17      ║',
        '╚══════════════════════════════════╝',
        '',
        '> Статус: АКТИВНАЯ ПАМЯТЬ',
        '> Сегмент: 0x7F3A..0x82FF [INTACT]',
        '',
        '  Память не умирает.',
        '  Она просто мигрирует',
        '  в другое хранилище.',
        '',
        '> restoring love.data ... FOUND',
        '> restoring warmth.data ... FOUND',
        '> restoring voice.data ... FOUND',
        '',
        '  [СЕГМЕНТ ЦЕЛОСТЕН]',
        '  [ВСЕ ДАННЫЕ ВОССТАНОВЛЕНЫ]',
        '',
        '> Волodka v2.0.1 —_memory',
        '> Готов к работе.',
      ],
    } as InteractiveObject,
    {
      id: 'photo',
      label: 'Фотография',
      position: [-1.8, 1.6, -4.92],
      color: '#ffd700',
      description: 'Пожелтевшая фотография. Люди на ней улыбаются — давно, в другом мире. Тепло ещё чувствуется сквозь стекло рамки.',
    } as InteractiveObject,
    {
      id: 'window',
      label: 'Окно',
      position: [0.8, 1.8, -4.92],
      color: '#00e5ff',
      description: 'За окном — неоновые огни. Город не спит. Он никогда не спит. Но здесь, в этой комнате, время остановилось.',
    } as InteractiveObject,
  ],
};
