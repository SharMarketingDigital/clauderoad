// Data-as-code content. Add classes here; the sim reads them.
// (Mirrors src/sim/content/ in World of Claudecraft.)
export interface ClassDef {
  id: string;
  name: string;
  baseHp: number;
  // Provisional combat stats — placeholders loosely echoing a WoW-Classic-ish
  // melee profile, NOT tuned yet (see GDD §B1; ground real numbers later).
  baseStr: number; // starting Strength (feeds melee damage)
  weaponDamage: number; // base weapon (sword) damage per swing
  swingTime: number; // seconds between melee auto-attacks
}

export const CLASSES: ClassDef[] = [
  { id: 'warrior', name: 'Guerreiro', baseHp: 120, baseStr: 20, weaponDamage: 6, swingTime: 2.0 },
  // TODO: mago, arqueiro, etc. — keep balance numbers grounded in a reference RPG.
];
