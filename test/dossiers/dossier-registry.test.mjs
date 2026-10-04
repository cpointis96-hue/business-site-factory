import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createDossierRegistry } from '../../src/dossiers/dossier-registry.mjs';

test('crée un dossier persistant avec histoire, menu et image bornée', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-dossier-'));
  const store = createAtomicStore(root);
  const registry = createDossierRegistry({ store, idFactory: () => 'dossier-test' });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlGHgAAAABJRU5ErkJggg==', 'base64');
  const created = await registry.create({
    name: 'Maison Sillage',
    city: 'Pattaya',
    story: 'Une histoire fournie par le restaurateur.',
    menu: [{ name: 'Khao soi', price: 14 }],
    photo: { dataUrl: `data:image/png;base64,${image.toString('base64')}`, alt: 'Plat signature' },
  });

  assert.equal(created.id, 'dossier-test');
  assert.equal(created.story, 'Une histoire fournie par le restaurateur.');
  assert.equal(created.menu[0].name, 'Khao soi');
  assert.equal((await registry.list())[0].assetCount, 1);
  assert.deepEqual((await registry.readAsset(created.id, 'photo-1.png')).value, image);
});

test('conserve plusieurs photos d’un dossier', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-dossier-gallery-')); const store = createAtomicStore(root); const dossiers = createDossierRegistry({ store });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlGHgAAAABJRU5ErkJggg==', 'base64');
  const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
  const created = await dossiers.create({ name: 'Maison Sillage', city: 'Nantes', photos: [{ dataUrl, alt: 'Façade' }, { dataUrl, alt: 'Plat' }] });
  assert.deepEqual(created.assets.map(asset => asset.name), ['photo-1.png', 'photo-2.png']);
});

test('refuse un dossier incomplet et une image non autorisée', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-dossier-'));
  const registry = createDossierRegistry({ store: createAtomicStore(root) });
  await assert.rejects(() => registry.create({ city: 'Pattaya' }), /établissement est requis/);
  await assert.rejects(() => registry.create({ name: 'Maison', city: 'Pattaya', photo: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }), /Format d’image/);
});

test('ouvre uniquement le dossier validé par le registre', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-dossier-'));
  let opened = null;
  const registry = createDossierRegistry({ store: createAtomicStore(root), idFactory: () => 'dossier-open', opener: async target => { opened = target; } });
  await registry.create({ name: 'Maison', city: 'Pattaya' });
  assert.deepEqual(await registry.open('dossier-open'), { opened: true, id: 'dossier-open' });
  assert.equal(opened, path.join(root, 'dossiers', 'dossier-open'));
  await assert.rejects(() => registry.open('../outside'));
});
