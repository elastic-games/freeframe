# English and Russian review UI

FreeFrame supports English (`en`) and Russian (`ru`). The standalone Appearance page selects between these two languages and persists `ff_locale`. Server rendering reads the cookie. `?lang=en|ru` selects presentation for guest links. Unsupported values fall back to English.

Inside Elastic Labs Studio, the existing appearance handshake carries `locale` alongside `theme`. The bridge accepts messages only from the exact configured Studio origin and the actual parent window; only `en` and `ru` locale values are accepted. This updates labels in place, without reloading the asset or resetting camera, object/animation pose, pending annotations, selected version, or comment drafts.

The production appearance parent is `https://app.elasticlabs.com`; the legacy `.site` origin is rejected. Studio's light/dark mode overrides the embedded view only, including after delayed preference loading, and is never saved over the standalone theme preference. Unmounting the bridge restores the standalone appearance.

Use `useTranslation()` from `lib/i18n/locale-provider` in client components and `getServerTranslation()` in server components. Add English source messages and reviewed Russian counterparts to `lib/i18n/messages.ts`. Interpolated placeholders must match. Use the active locale for dates and relative time. System enum labels may be translated; enum values, permissions, payloads, identifiers, paths, authored asset/project titles, comments, metadata values and branding names must retain their source content. Never translate a form value or change authorization behavior to localize a label.

Keep locale dependencies out of effects that load media or construct WebGL scenes. Update captions and accessibility labels in place. Regression coverage verifies exact-origin language handoff, locale persistence, catalog placeholders, source coverage, and preservation of the same loaded 3D viewer/camera capture/pending drawing across a language change.

Run the normal frontend build/type/lint/test gates. On Node 25, use `NODE_OPTIONS=--no-experimental-webstorage` for Vitest so its browser storage comes from jsdom. Local browser verification uses an isolated session and synthetic fixture data; deployment and production acceptance remain separate steps.
