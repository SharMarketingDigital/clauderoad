// Data-as-code content for mobs.
export interface EnemyTemplate {
  id: string;
  name: string;
  hp: number;
  xp: number; // XP awarded to the killer (provisional; tune with the curve)
}

export const ENEMY_TEMPLATE: EnemyTemplate = { id: 'grey_wolf', name: 'Lobo Cinzento', hp: 40, xp: 25 };
export const ENEMY_COUNT = 12;
