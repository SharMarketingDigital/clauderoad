// Data-as-code content for mobs.
export interface EnemyTemplate {
  id: string;
  name: string;
  hp: number;
}

export const ENEMY_TEMPLATE: EnemyTemplate = { id: 'grey_wolf', name: 'Lobo Cinzento', hp: 40 };
export const ENEMY_COUNT = 12;
