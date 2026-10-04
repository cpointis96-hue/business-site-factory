import { ValidationError } from '../core/errors.mjs';

export function createGooglePlacesAutocomplete({ providers, adapters, secretStore }) {
  const ready = async () => {
    const provider = (await providers.list()).find(item => item.id === 'google-places');
    return provider?.enabled && provider.health === 'healthy' && provider.configured && adapters.googlePlaces;
  };
  const autocomplete = async function autocomplete({ input, countryCode, mode = 'city' }) {
    const query = String(input ?? '').trim(); const country = String(countryCode ?? '').trim().toUpperCase();
    if (query.length < 2 || (mode !== 'establishment' && !/^[A-Z]{2}$/.test(country))) throw new ValidationError('Recherche géographique invalide.');
    if (!await ready() || !adapters.googlePlaces.autocomplete) return { status: 'PARTIAL', cause: 'GOOGLE_PLACES_NOT_CONFIGURED', suggestions: [] };
    const secret = await secretStore.get('provider:google-places');
    const body = await adapters.googlePlaces.autocomplete({ secret, input: query, countryCode: country, mode });
    const suggestions = (body?.suggestions ?? []).map(item => item.placePrediction).filter(Boolean).map(item => ({ placeId: String(item.placeId ?? ''), label: String(item.text?.text ?? '').trim(), primaryText: String(item.structuredFormat?.mainText?.text ?? '').trim(), secondaryText: String(item.structuredFormat?.secondaryText?.text ?? '').trim() })).filter(item => item.placeId && item.label);
    return { status: 'SUCCEEDED', suggestions };
  };
  autocomplete.details = async ({ placeId }) => {
    const value = String(placeId ?? '').trim();
    if (!value || value.includes('/') || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ValidationError('Établissement invalide.');
    if (!await ready() || !adapters.googlePlaces.details) return { status: 'PARTIAL', cause: 'GOOGLE_PLACES_NOT_CONFIGURED' };
    const body = await adapters.googlePlaces.details({ secret: await secretStore.get('provider:google-places'), placeId: value });
    const component = type => body.addressComponents?.find(item => item.types?.includes(type));
    const city = component('locality') ?? component('postal_town') ?? component('administrative_area_level_2');
    const country = component('country');
    const latitude = Number(body.location?.latitude); const longitude = Number(body.location?.longitude);
    return { status: 'SUCCEEDED', establishment: { placeId: String(body.id ?? value).replace(/^places\//, ''), name: String(body.displayName?.text ?? '').trim(), formattedAddress: String(body.formattedAddress ?? '').trim(), websiteUri: String(body.websiteUri ?? '').trim() || null, cityLabel: String(city?.longText ?? '').trim(), countryCode: String(country?.shortText ?? '').trim().toUpperCase(), countryLabel: String(country?.longText ?? '').trim(), coordinates: Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null, ...(body.primaryType ? { primaryType: String(body.primaryType).trim() } : {}), ...(body.primaryTypeDisplayName?.text ? { primaryTypeDisplayName: String(body.primaryTypeDisplayName.text).trim() } : {}), ...(Array.isArray(body.types) && body.types.length ? { types: body.types.map(item => String(item).trim()).filter(Boolean) } : {}), ...(body.businessStatus ? { businessStatus: String(body.businessStatus).trim() } : {}) } };
  };
  return autocomplete;
}
