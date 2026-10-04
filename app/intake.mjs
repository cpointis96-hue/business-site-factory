import { api } from './api.mjs';

const nav = document.querySelector('.client-nav');
const menuButton = document.querySelector('.menu-button');
const auditForm = document.querySelector('#audit-form');
const auditState = document.querySelector('#audit-state');
const dossierSection = document.querySelector('#dossier-section');
const dossierForm = document.querySelector('#dossier-form');
const photoInput = document.querySelector('#photo');
const preview = document.querySelector('#photo-preview');
const dossierState = document.querySelector('#dossier-state');

function imageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result), { once: true });
    reader.addEventListener('error', () => reject(new Error('Impossible de lire cette image.')), { once: true });
    reader.readAsDataURL(file);
  });
}

function parseMenu(value) {
  return value.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => {
    const [name, rawPrice = ''] = line.split('|').map(part => part.trim());
    if (!name) throw new Error(`Plat invalide à la ligne ${index + 1}.`);
    const price = rawPrice === '' ? null : Number(rawPrice.replace(',', '.'));
    if (price !== null && !Number.isFinite(price)) throw new Error(`Prix invalide à la ligne ${index + 1}.`);
    return { name, price };
  });
}

menuButton?.addEventListener('click', () => {
  const open = nav.classList.toggle('menu-open');
  menuButton.setAttribute('aria-expanded', String(open));
});

auditForm.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(auditForm);
  const name = String(data.get('name')).trim();
  const city = String(data.get('city')).trim();
  if (!name || !city) return;
  dossierSection.hidden = false;
  auditState.textContent = 'Votre établissement est identifié. Complétez votre dossier pour préparer la suite.';
  auditState.classList.add('show');
  dossierSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  dossierForm.querySelector('[name="country"]').focus();
});

photoInput.addEventListener('change', async () => {
  dossierState.textContent = '';
  preview.hidden = true;
  preview.replaceChildren();
  const file = photoInput.files[0];
  if (!file) return;
  if (file.size > 700 * 1024) { dossierState.textContent = 'Cette image dépasse 700 Ko.'; photoInput.value = ''; return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { dossierState.textContent = 'Format d’image non autorisé.'; photoInput.value = ''; return; }
  const image = document.createElement('img');
  image.src = await imageData(file);
  image.alt = 'Aperçu de l’image sélectionnée';
  preview.append(image);
  preview.hidden = false;
});

dossierForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = dossierForm.querySelector('button[type="submit"]');
  const identity = new FormData(auditForm);
  const data = new FormData(dossierForm);
  button.disabled = true;
  dossierState.textContent = 'Enregistrement…';
  try {
    const file = photoInput.files[0];
    const profile = {
      name: String(identity.get('name')).trim(),
      city: String(identity.get('city')).trim(),
      country: data.get('country'),
      address: data.get('address'),
      contact: data.get('contact'),
      story: data.get('story'),
      menu: parseMenu(String(data.get('menu') ?? '')),
    };
    if (file) profile.photo = { dataUrl: await imageData(file), alt: `Image de ${profile.name}` };
    await api.createIntake(profile);
    dossierForm.hidden = true;
    dossierSection.querySelector('.section-grid').hidden = true;
    document.querySelector('#intake-success').hidden = false;
    document.querySelector('#intake-success').focus();
  } catch (error) {
    dossierState.textContent = error.message;
    button.disabled = false;
  }
});
