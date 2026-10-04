import test from 'node:test';
import assert from 'node:assert/strict';
import { createGooglePlacesAutocomplete } from '../../src/geography/google-places-autocomplete.mjs';

test('retourne le site public d’un établissement Google Places sélectionné', async () => {
  const autocomplete = createGooglePlacesAutocomplete({
    providers: { async list() { return [{ id: 'google-places', enabled: true, health: 'healthy', configured: true }]; } },
    adapters: { googlePlaces: {
      async details() { return { id: 'places/place-1', displayName: { text: 'Maison Sillage' }, formattedAddress: '1 rue du Port, Nantes, France', websiteUri: 'https://maison-sillage.example', primaryType: 'restaurant', primaryTypeDisplayName: { text: 'Restaurant' }, types: ['restaurant', 'food'], businessStatus: 'OPERATIONAL', addressComponents: [
        { types: ['locality'], longText: 'Nantes' }, { types: ['country'], shortText: 'FR', longText: 'France' },
      ], location: { latitude: 47.2184, longitude: -1.5536 } }; },
    } },
    secretStore: { async get() { return 'places-key'; } },
  });

  const result = await autocomplete.details({ placeId: 'place-1' });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.establishment.websiteUri, 'https://maison-sillage.example');
  assert.equal(result.establishment.primaryType, 'restaurant');
  assert.equal(result.establishment.businessStatus, 'OPERATIONAL');
  assert.equal(result.establishment.cityLabel, 'Nantes');
  assert.deepEqual(result.establishment.coordinates, { latitude: 47.2184, longitude: -1.5536 });
});
