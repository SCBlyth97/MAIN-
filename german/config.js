// ─────────────────────────────────────────────────────────────────────────────
// Deutsch — config.js
// Supabase project credentials. Loaded before app.js in index.html.
//
// WHY THE ANON KEY IS SAFE TO COMMIT AND PUBLISH:
// The anon (public) key identifies your Supabase project but carries no
// elevated privileges on its own. Row Level Security (RLS) on the
// user_progress table means every database request — even one using this
// key — can only read or write the single row belonging to the currently
// signed-in user. A stranger with this key cannot see your data.
//
// The service_role key is different: it bypasses RLS and must NEVER appear
// in client-side code or be committed to a public repository. Keep it only
// in server-side environments (e.g. Supabase Edge Functions, your own backend).
// ─────────────────────────────────────────────────────────────────────────────

window.SUPABASE_URL      = 'https://sxhitzxbrkkxdrgpgtjf.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_GOKZbqVVpnt_VQQczE40wA_s6ebuoIU';
