// Character PERSISTENCE (data only — NOT gameplay). Serializes a player's progression to
// a plain JSON-safe object and applies a (possibly untrusted) saved object back onto a
// player entity, DEFENSIVELY. This never reads/writes any gameplay rule, formula, RNG, or
// tick logic — it only moves the progression DATA in and out. The Sim's serializePlayer/
// restorePlayer wrap these; the offline single-player never calls them.
//
// Hard rule: applySave must NEVER throw or produce invalid state from bad input. Anything
// missing/corrupt is dropped and the entity keeps its fresh-spawn value, so a garbage DB
// row can't break the Sim. The caller (Sim) recomputes derived stats afterwards.
import type { Entity, ItemStack, EquippedItem } from './types';
import type { EquipSlot, Rarity } from '../world_api';
import { ITEMS } from './content/items';
import { BAG_SLOTS, EQUIP_SLOTS, STORAGE_SLOTS, PETBAG_SLOTS } from './inventory';
import { MAX_PLUS } from './content/enhance';
import { SKILL_MAX_RANK } from './content/skill_ranks';
import { MAX_DURABILITY } from './content/durability';
import { CITIES } from './zones';

// The persistent slice of a character (what defines its progression). Plain + JSON-safe.
// Excludes derived stats (str/maxHp/… — recomputed) and transient combat/position state.
export interface PlayerSave {
  level: number;
  xp: number;
  attrPoints: number;
  baseStr: number;
  baseInt: number;
  baseMaxHp: number;
  baseMaxMp: number;
  sp: number;
  skillRanks: Record<string, number>;
  gold: number;
  bag: (ItemStack | null)[]; // SPARSE/positional (holes = null); trailing nulls trimmed on save
  equipment: Record<EquipSlot, EquippedItem | null>;
  storage: (ItemStack | null)[]; // K5: armazém/banco da cidade (mesmo modelo esparso da bag)
  petBag: (ItemStack | null)[]; // GDD v0.5 (Pets PET2): the transport pet's portable bag (same sparse model)
  returnCity: string; // GDD v0.5 (teleporte): the registered Return/respawn city id (a known CITIES id)
  autoPotHpPct?: number; // Sistema 15 (QoL): saved auto-pot HP threshold (0..1). Absent/old saves => off.
  autoPotMpPct?: number; // Sistema 15 (QoL, Fatia 2): saved auto-pot MP threshold (0..1). Absent => off.
  lastFieldPos?: { x: number; z: number }; // Sistema 15 (reverse scroll): recorded grind spot. Absent => none.
}

// Read the persistent progression off a player entity into a fresh, JSON-safe object
// (deep-copied so it never aliases the entity's own arrays/maps).
export function toSave(e: Entity): PlayerSave {
  const equipment = {} as Record<EquipSlot, EquippedItem | null>;
  for (const slot of EQUIP_SLOTS) {
    const it = e.equipment[slot];
    equipment[slot] = it ? { ...it } : null;
  }
  return {
    level: e.level,
    xp: e.xp,
    attrPoints: e.attrPoints,
    baseStr: e.baseStr,
    baseInt: e.baseInt,
    baseMaxHp: e.baseMaxHp,
    baseMaxMp: e.baseMaxMp,
    sp: e.sp,
    skillRanks: { ...e.skillRanks },
    gold: e.gold,
    // SPARSE bags: preserve each item's POSITION (holes = null), trimming trailing nulls so an
    // empty bag round-trips to [] and a packed bag to a plain list (back-compat with old saves).
    // map por-campo (NÃO spread) p/ preservar o deep-copy: nunca aliasa os stacks da entidade.
    bag: trimTrailingNulls(e.bag.map((s) => (s ? { itemId: s.itemId, rarity: s.rarity, plus: s.plus, qty: s.qty } : null))),
    equipment,
    storage: trimTrailingNulls(e.storage.map((s) => (s ? { itemId: s.itemId, rarity: s.rarity, plus: s.plus, qty: s.qty } : null))),
    // GDD v0.5 (Pets PET2): persist the transport pet's bag (may be undefined for a player who never used one)
    petBag: trimTrailingNulls((e.petBag ?? []).map((s) => (s ? { itemId: s.itemId, rarity: s.rarity, plus: s.plus, qty: s.qty } : null))),
    returnCity: e.returnCity, // GDD v0.5: persist the registered Return/respawn city
    autoPotHpPct: e.autoPotHpPct, // Sistema 15 (QoL): persist the auto-pot preference (undefined = off, omitted by JSON)
    autoPotMpPct: e.autoPotMpPct, // Sistema 15 (QoL, Fatia 2): persist the MP auto-pot preference
    // Sistema 15 (reverse scroll): persist the recorded grind spot (deep-copied; undefined = none, omitted by JSON).
    lastFieldPos: e.lastFieldPos ? { x: e.lastFieldPos.x, z: e.lastFieldPos.z } : undefined,
  };
}

// Apply an UNTRUSTED saved object onto a player entity, field by field. Every value is
// validated; an invalid scalar keeps the entity's current (fresh-spawn) value, and an
// invalid bag/equipment/ranks resets to empty (= a fresh character). Never throws.
export function applySave(e: Entity, raw: unknown): void {
  if (!isObj(raw)) return; // not even an object -> leave the fresh spawn untouched
  if (isInt(raw.level) && raw.level >= 1) e.level = raw.level;
  if (isNum(raw.xp) && raw.xp >= 0) e.xp = raw.xp;
  if (isInt(raw.attrPoints) && raw.attrPoints >= 0) e.attrPoints = raw.attrPoints;
  if (isNum(raw.baseStr) && raw.baseStr >= 0) e.baseStr = raw.baseStr;
  if (isNum(raw.baseInt) && raw.baseInt >= 0) e.baseInt = raw.baseInt;
  if (isNum(raw.baseMaxHp) && raw.baseMaxHp > 0) e.baseMaxHp = raw.baseMaxHp; // must stay > 0 (HP pool)
  if (isNum(raw.baseMaxMp) && raw.baseMaxMp >= 0) e.baseMaxMp = raw.baseMaxMp;
  if (isInt(raw.sp) && raw.sp >= 0) e.sp = raw.sp;
  if (isNum(raw.gold) && raw.gold >= 0) e.gold = Math.floor(raw.gold);
  e.skillRanks = sanitizeRanks(raw.skillRanks);
  e.bag = sanitizeBag(raw.bag, BAG_SLOTS);
  e.storage = sanitizeBag(raw.storage, STORAGE_SLOTS); // ausente => holes (back-compat de saves antigos)
  e.petBag = sanitizeBag(raw.petBag, PETBAG_SLOTS); // GDD v0.5 (Pets PET2); ausente => holes (back-compat)
  const eq = sanitizeEquipment(raw.equipment);
  for (const slot of EQUIP_SLOTS) e.equipment[slot] = eq[slot];
  // GDD v0.5: accept a registered city only if it's a KNOWN city id; otherwise keep the fresh-spawn
  // default ('town'). Back-compat: old saves with no returnCity simply keep that default.
  if (typeof raw.returnCity === 'string' && CITIES.some((c) => c.id === raw.returnCity)) {
    e.returnCity = raw.returnCity;
  }
  // Sistema 15 (QoL): restore the auto-pot preference only if it's a valid fraction [0,1]; otherwise leave
  // the fresh-spawn default (undefined = off). Back-compat: old saves with no field simply stay off.
  if (isNum(raw.autoPotHpPct) && raw.autoPotHpPct >= 0 && raw.autoPotHpPct <= 1) {
    e.autoPotHpPct = raw.autoPotHpPct;
  }
  if (isNum(raw.autoPotMpPct) && raw.autoPotMpPct >= 0 && raw.autoPotMpPct <= 1) {
    e.autoPotMpPct = raw.autoPotMpPct;
  }
  // Sistema 15 (reverse scroll): restore the recorded grind spot only if it's a valid {x,z} of finite
  // numbers; otherwise leave it unset. Back-compat: old saves with no field simply have no reverse target.
  if (isObj(raw.lastFieldPos) && isNum(raw.lastFieldPos.x) && isNum(raw.lastFieldPos.z)) {
    e.lastFieldPos = { x: raw.lastFieldPos.x, z: raw.lastFieldPos.z };
  }
}

// ---- validation helpers (pure) ----
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isInt(v: unknown): v is number {
  return isNum(v) && Number.isInteger(v);
}
function isRarity(v: unknown): v is Rarity {
  return v === 'normal' || v === 'sos' || v === 'som' || v === 'sun';
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sanitizeRanks(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    // keep any ability id with a valid rank; unknown ids are harmless (the sim ignores them)
    if (isInt(v) && v >= 1 && v <= SKILL_MAX_RANK) out[k] = v;
  }
  return out;
}

// Place each validated stack at its INPUT INDEX into a fixed-length sparse array (holes = null),
// preserving drag-placed positions. Handles BOTH old compact saves (items packed at 0..n-1) and
// new sparse saves (with nulls) uniformly. Missing/invalid/out-of-range entries become holes.
function sanitizeBag(raw: unknown, maxSlots: number): (ItemStack | null)[] {
  const out: (ItemStack | null)[] = new Array(maxSlots).fill(null);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < raw.length && i < maxSlots; i++) {
    out[i] = sanitizeStack(raw[i]); // null when the entry is missing/invalid
  }
  return out;
}

// Drop trailing nulls so an empty bag serializes to [] and a packed bag to a plain list (keeps the
// save compact + back-compatible while still preserving interior holes / item positions).
function trimTrailingNulls<T>(arr: (T | null)[]): (T | null)[] {
  let end = arr.length;
  while (end > 0 && arr[end - 1] == null) end--;
  return arr.slice(0, end);
}
function sanitizeStack(raw: unknown): ItemStack | null {
  if (!isObj(raw)) return null;
  if (typeof raw.itemId !== 'string' || !ITEMS[raw.itemId]) return null; // unknown item -> drop
  if (!isRarity(raw.rarity)) return null;
  if (!isInt(raw.plus) || raw.plus < 0 || raw.plus > MAX_PLUS) return null;
  if (!isInt(raw.qty) || raw.qty < 1) return null;
  return { itemId: raw.itemId, rarity: raw.rarity, plus: raw.plus, qty: raw.qty };
}

function sanitizeEquipment(raw: unknown): Record<EquipSlot, EquippedItem | null> {
  const out = {} as Record<EquipSlot, EquippedItem | null>;
  const obj: Record<string, unknown> = isObj(raw) ? raw : {};
  for (const slot of EQUIP_SLOTS) out[slot] = sanitizeEquipped(obj[slot], slot);
  return out;
}
function sanitizeEquipped(raw: unknown, slot: EquipSlot): EquippedItem | null {
  if (!isObj(raw)) return null;
  if (typeof raw.itemId !== 'string' || ITEMS[raw.itemId]?.slot !== slot) return null; // unknown / wrong slot -> drop
  if (!isRarity(raw.rarity)) return null;
  if (!isInt(raw.plus) || raw.plus < 0 || raw.plus > MAX_PLUS) return null;
  const durability = isNum(raw.durability) ? clamp(raw.durability, 0, MAX_DURABILITY) : MAX_DURABILITY;
  return { itemId: raw.itemId, rarity: raw.rarity, plus: raw.plus, durability };
}
