// Data-as-code item definitions. Placeholders for now — just data, NO effects
// yet (consuming a potion, equipping a sword, etc. come later). The bag stores
// item ids; the UI resolves names through ITEMS via IWorld.
export interface ItemDef {
  id: string;
  name: string;
}

export const ITEMS: Record<string, ItemDef> = {
  health_potion: { id: 'health_potion', name: 'Poção de Vida' },
  wolf_leather: { id: 'wolf_leather', name: 'Couro de Lobo' },
  old_sword: { id: 'old_sword', name: 'Espada Velha' },
};
