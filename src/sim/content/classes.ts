// Data-as-code content. Add classes here; the sim reads them.
// (Mirrors src/sim/content/ in World of Claudecraft.)
export interface ClassDef {
  id: string;
  name: string;
  baseHp: number;
}

export const CLASSES: ClassDef[] = [
  { id: 'warrior', name: 'Guerreiro', baseHp: 120 },
  // TODO: mago, arqueiro, etc. — keep balance numbers grounded in a reference RPG.
];
