import { AppError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId, createId } from '../core/ids.mjs';

const INDEX_PATH = 'dossiers/index.json';
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const MAX_IMAGE_BYTES = 700 * 1024;

const dossierPath = (id, suffix) => `dossiers/${id}/${suffix}`;

function text(value, field, { required = false, max = 4000 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} est requis.`, { field });
    return '';
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} est invalide.`, { field });
  const normalized = value.trim();
  if (required && !normalized) throw new ValidationError(`${field} est requis.`, { field });
  if (normalized.length > max) throw new ValidationError(`${field} est trop long.`, { field });
  return normalized;
}

function menuItems(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new ValidationError('Menu invalide.', { field: 'menu' });
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ValidationError('Plat invalide.', { field: `menu.${index}` });
    const name = text(item.name, `menu.${index}.name`, { required: true, max: 120 });
    const description = text(item.description, `menu.${index}.description`, { max: 500 });
    const price = item.price === '' || item.price === undefined || item.price === null ? null : Number(item.price);
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) throw new ValidationError('Prix invalide.', { field: `menu.${index}.price` });
    return { name, description, price };
  });
}

function decodeImage(photo) {
  if (!photo) return null;
  if (typeof photo !== 'object' || typeof photo.dataUrl !== 'string') throw new ValidationError('Image invalide.', { field: 'photo' });
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo.dataUrl);
  if (!match || !IMAGE_TYPES.has(match[1])) throw new ValidationError('Format d’image non autorisé.', { field: 'photo' });
  const value = Buffer.from(match[2], 'base64');
  if (!value.length || value.length > MAX_IMAGE_BYTES) throw new ValidationError('Image trop volumineuse.', { field: 'photo' });
  const validSignature = match[1] === 'image/png'
    ? value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'image/jpeg'
      ? value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff
      : value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!validSignature) throw new ValidationError('Le contenu de l’image ne correspond pas à son format.', { field: 'photo' });
  const metadata = {};
  if (photo.category !== undefined) metadata.category = text(photo.category, 'photo.category', { required: true, max: 80 });
  if (photo.rightsStatus !== undefined) metadata.rightsStatus = text(photo.rightsStatus, 'photo.rightsStatus', { required: true, max: 40 });
  return { value, type: match[1], extension: IMAGE_TYPES.get(match[1]), alt: text(photo.alt, 'photo.alt', { max: 180 }), ...metadata };
}

export function createDossierRegistry({ store, opener = null, clock = () => new Date(), idFactory = prefix => createId(prefix, clock()) }) {
  async function addToIndex(id) {
    const currentText = await store.readText(INDEX_PATH, null);
    const current = currentText === null ? [] : JSON.parse(currentText);
    if (current.includes(id)) return;
    await store.writeJson(INDEX_PATH, [...current, id].sort(), { expectedHash: currentText === null ? null : store.hashText(currentText) });
  }

  async function get(id) {
    assertResourceId(id, 'dossierId');
    const dossier = await store.readJson(dossierPath(id, 'dossier.json'), null);
    if (!dossier) throw new NotFoundError(`Dossier introuvable : ${id}`);
    const [story, menu] = await Promise.all([
      store.readText(dossierPath(id, 'story.md'), ''),
      store.readJson(dossierPath(id, 'menu.json'), []),
    ]);
    return { ...dossier, story, menu };
  }

  async function list() {
    const ids = await store.readJson(INDEX_PATH, []);
    const items = await Promise.all(ids.map(get));
    return items
      .map(({ story, menu, ...item }) => ({
        ...item,
        hasStory: Boolean(story.trim()),
        menuItemCount: menu.length,
        assetCount: item.assets?.length ?? 0,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function create(profile = {}, { source = 'local-public-intake', id: suppliedId = null } = {}) {
    if (!profile || typeof profile !== 'object') throw new ValidationError('Dossier invalide.');
    const id = suppliedId === null ? idFactory('dossier') : assertResourceId(suppliedId, 'dossierId');
    const now = clock().toISOString();
    const photos = Array.isArray(profile.photos) ? profile.photos : profile.photo ? [profile.photo] : [];
    if (photos.length > 5) throw new ValidationError('Trop d’images.', { field: 'photos' });
    const decodedPhotos = photos.map(decodeImage).filter(Boolean);
    const menu = menuItems(profile.menu);
    const story = text(profile.story, 'histoire', { max: 12000 });
    const dossier = {
      id,
      name: text(profile.name, 'établissement', { required: true, max: 160 }),
      city: text(profile.city, 'ville', { required: true, max: 160 }),
      country: text(profile.country, 'pays', { max: 120 }),
      address: text(profile.address, 'adresse', { max: 500 }),
      contact: text(profile.contact, 'contact', { max: 320 }),
      source,
      provenance: source,
      status: 'INTAKE_COMPLETE',
      assets: [],
      createdAt: now,
      updatedAt: now,
    };
    for (const [index, photo] of decodedPhotos.entries()) {
      const name = `photo-${index + 1}.${photo.extension}`;
      const written = await store.writeBuffer(dossierPath(id, `assets/${name}`), photo.value, { expectedHash: null });
      dossier.assets.push({ name, type: photo.type, size: photo.value.length, hash: written.hash, alt: photo.alt, source: 'intake-upload', ...(photo.category ? { category: photo.category } : {}), ...(photo.rightsStatus ? { rightsStatus: photo.rightsStatus } : {}) });
    }
    await store.writeJson(dossierPath(id, 'dossier.json'), dossier, { expectedHash: null });
    await store.writeText(dossierPath(id, 'story.md'), story, { expectedHash: null });
    await store.writeJson(dossierPath(id, 'menu.json'), menu, { expectedHash: null });
    await addToIndex(id);
    return get(id);
  }

  async function readAsset(id, name) {
    const dossier = await get(id);
    const asset = dossier.assets.find(item => item.name === name);
    if (!asset) throw new NotFoundError('Image introuvable.');
    const value = await store.readBuffer(dossierPath(id, `assets/${asset.name}`), null);
    if (!value) throw new NotFoundError('Image introuvable.');
    return { ...asset, value };
  }

  async function open(id) {
    await get(id);
    if (!opener) throw new AppError('Ouverture Finder indisponible sur cette machine.', { code: 'OPEN_NOT_AVAILABLE', status: 501 });
    await opener(store.resolveSafe(`dossiers/${id}/dossier.json`).replace(/\/dossier\.json$/, ''));
    return { opened: true, id };
  }

  return { create, get, list, open, readAsset };
}
