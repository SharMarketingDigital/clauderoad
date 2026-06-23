// Data-as-code content. Add classes here; the sim reads them.
// (Mirrors src/sim/content/ in World of Claudecraft.)
export interface ClassDef {
  id: string;
  name: string;
  baseHp: number;
  baseMp: number; // resource pool for abilities (Intelligence will grow this later)
  // Provisional combat stats — placeholders loosely echoing a WoW-Classic-ish
  // melee profile, NOT tuned yet (see GDD §B1; ground real numbers later).
  baseStr: number; // starting Strength (feeds melee damage)
  weaponDamage: number; // base weapon (sword) damage per swing
  swingTime: number; // seconds between melee auto-attacks
}

export const CLASSES: ClassDef[] = [
  { id: 'warrior', name: 'Guerreiro', baseHp: 120, baseMp: 100, baseStr: 20, weaponDamage: 6, swingTime: 2.0 },
  // TODO: mago, arqueiro, etc. — keep balance numbers grounded in a reference RPG.
];

// The 4 SELECTABLE classes (GDD v0.3 §G1). Each is just a starter WEAPON whose mastery IS
// the class's kit (Espada / Lança / Arco / Mago already exist in content/abilities.ts). This
// is data only: the class-select screen lists these, and the sim equips `weaponId` on a
// `select-class` command (for a fresh character — it never overwrites existing gear). No new
// content is needed; picking a class just hands you that weapon + its kit.
export interface PlayerClass {
  id: string; // stable id sent in the select-class command
  name: string; // display name on the selection screen
  description: string; // one line summarizing the playstyle + kit
  weaponId: string; // starter weapon (an id in content/items.ts); its mastery = the class kit
}

export const PLAYER_CLASSES: PlayerClass[] = [
  { id: 'swordshield', name: 'Espada & Escudo', weaponId: 'old_sword',
    description: 'Corpo-a-corpo defensivo: Golpe Forte, Postura Defensiva e Atordoamento.' },
  { id: 'spear', name: 'Lança', weaponId: 'iron_spear',
    description: 'Corpo-a-corpo perfurante em área: Estocada, Varredura, Investida e Fúria.' },
  { id: 'archer', name: 'Arqueiro', weaponId: 'short_bow',
    description: 'Dano físico à distância: Tiro Carregado, Tiro Múltiplo e Tiro Lento (kiting).' },
  { id: 'mage', name: 'Mago', weaponId: 'apprentice_staff',
    description: 'Magia à distância: Bola de Fogo, Onda de Chamas e Lança de Gelo.' },
];

export const PLAYER_CLASS_BY_ID: Record<string, PlayerClass> = Object.fromEntries(
  PLAYER_CLASSES.map((c) => [c.id, c]),
);
