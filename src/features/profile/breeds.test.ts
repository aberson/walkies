// src/features/profile/breeds.test.ts — the breed seed (assets/breeds.json)
// matches Appendix A's brachycephalic / double-coat lists and exposes a Custom
// sentinel.

import {
  BREED_NAMES,
  BREED_SEEDS,
  CUSTOM_BREED,
  breedSeed,
} from './breeds';

// Appendix A: brachycephalic TRUE list.
const BRACHY = [
  'English Bulldog',
  'French Bulldog',
  'Pug',
  'Boston Terrier',
  'Boxer',
  'Shih Tzu',
  'Pekingese',
  'Cavalier King Charles Spaniel',
  'Chow Chow',
  'Lhasa Apso',
  'Brussels Griffon',
];

// Appendix A: double-coat (double_thick) TRUE list.
const DOUBLE_COAT = [
  'Siberian Husky',
  'Alaskan Malamute',
  'Chow Chow',
  'Golden Retriever',
  'Collie',
  'German Shepherd',
  'Samoyed',
  'Bernese Mountain Dog',
];

describe('breed seed', () => {
  it('marks every Appendix A brachycephalic breed brachycephalic=true', () => {
    for (const name of BRACHY) {
      expect(breedSeed(name)?.brachycephalic).toBe(true);
    }
  });

  it('gives every Appendix A double-coat breed coat=double_thick', () => {
    for (const name of DOUBLE_COAT) {
      expect(breedSeed(name)?.coat).toBe('double_thick');
    }
  });

  it('keeps Bernese Mountain Dog at giant size (Appendix A note)', () => {
    expect(breedSeed('Bernese Mountain Dog')?.size).toBe('giant');
  });

  it('treats common non-brachy breeds as not brachycephalic', () => {
    expect(breedSeed('Labrador Retriever')?.brachycephalic).toBe(false);
    expect(breedSeed('Mixed breed / Other')?.brachycephalic).toBe(false);
  });

  it('exposes a Custom sentinel in the seed list', () => {
    expect(BREED_NAMES).toContain(CUSTOM_BREED);
    expect(breedSeed(CUSTOM_BREED)).toBeDefined();
  });

  it('returns undefined for an unknown breed name', () => {
    expect(breedSeed('Velociraptor')).toBeUndefined();
  });

  it('has no duplicate breed names', () => {
    expect(new Set(BREED_NAMES).size).toBe(BREED_SEEDS.length);
  });
});
