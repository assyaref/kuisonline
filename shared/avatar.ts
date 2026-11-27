import { z } from 'zod';

/** Number of variants for each mix-and-match avatar part. */
export const AVATAR_PARTS = {
  /** head shape: round (animal), box (robot), blob (monster), egg (alien) */
  h: 4,
  /** body colour */
  c: 12,
  /** ears / top: none, cat, bunny, bear, horns, robot antenna, alien antennae, dino spikes, fox */
  r: 9,
  /** eyes: dots, big shiny, sleepy, cyclops, visor, angry, star */
  e: 7,
  /** mouth: smile, open, fangs, tongue, grill, cat, surprised */
  m: 7,
  /** accessory: none, crown, party hat, glasses, bow, headphones, beanie, flower, cap */
  a: 9,
  /** pattern: none, belly, spots, stripes */
  p: 4,
} as const;

export type AvatarPart = keyof typeof AVATAR_PARTS;

const part = (k: AvatarPart) => z.number().int().min(0).max(AVATAR_PARTS[k] - 1);

export const avatarSchema = z.object({
  h: part('h'),
  c: part('c'),
  r: part('r'),
  e: part('e'),
  m: part('m'),
  a: part('a'),
  p: part('p'),
});

export type Avatar = z.infer<typeof avatarSchema>;

export function randomAvatar(rand: (n: number) => number = (n) => Math.floor(Math.random() * n)): Avatar {
  return {
    h: rand(AVATAR_PARTS.h),
    c: rand(AVATAR_PARTS.c),
    r: rand(AVATAR_PARTS.r),
    e: rand(AVATAR_PARTS.e),
    m: rand(AVATAR_PARTS.m),
    a: rand(AVATAR_PARTS.a),
    p: rand(AVATAR_PARTS.p),
  };
}

export const REACTIONS = ['👍', '😂', '😮', '🔥', '❤️', '👏'] as const;

const ADJ = [
  'Ngebut', 'Ceria', 'Galak', 'Ajaib', 'Kilat', 'Jenius', 'Santuy', 'Lincah', 'Misterius', 'Kocak',
  'Pemberani', 'Bersinar', 'Gesit', 'Imut', 'Sakti', 'Turbo', 'Gokil', 'Cerdik', 'Kalem', 'Heboh',
];
const NOUN = [
  'Kucing', 'Panda', 'Robot', 'Naga', 'Komodo', 'Kelinci', 'Alien', 'Monster', 'Pinguin', 'Rubah',
  'Harimau', 'Gajah', 'Burung Hantu', 'Dino', 'Orangutan', 'Lumba-lumba', 'Kancil', 'Badak', 'Cendrawasih', 'Tapir',
];

export function generateName(rand: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  return `${NOUN[rand(NOUN.length)]} ${ADJ[rand(ADJ.length)]}`;
}
